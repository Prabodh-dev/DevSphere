import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import Follow from "../models/Follow.js";
import User from "../models/User.js";
import { config } from "../config/index.js";
import { getRedisClient } from "../config/redis.js";
import { logger } from "../utils/logger.js";

// A connection counts as open for this long after its last heartbeat. Open
// sockets send a heartbeat every third of it, so a crashed instance's
// connections drop out of the count by themselves.
const DEFAULT_TTL_MS = 90 * 1000;

// Each connection is a member of the user's sorted set, scored by the time it
// expires. The size of the set is the number of open connections.
const ADD = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return redis.call('ZCARD', KEYS[1])
`;
const REMOVE = `
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZCARD', KEYS[1])
`;

// Who is online: the number of open connections per user. In Redis (shared by
// every app instance) when it is available, otherwise in memory. A user is
// online while they have at least one connection.
export class PresenceTracker {
  constructor({ ttlMs = DEFAULT_TTL_MS, getClient = getRedisClient } = {}) {
    this.ttlMs = ttlMs;
    this.getClient = getClient;
    // userId -> Map(socketId -> expiry time)
    this.memory = new Map();
    // socketId -> where its connection was counted
    this.where = new Map();
    this.warned = false;
  }

  get heartbeatMs() {
    return Math.floor(this.ttlMs / 3);
  }

  key(userId) {
    return `${config.redis.keyPrefix}presence:${userId}`;
  }

  // The Redis client, or null to count in memory.
  client() {
    if (!config.redis.url) return null;
    return this.getClient();
  }

  failed(err) {
    if (this.warned) return;
    this.warned = true;
    logger.warn(
      { err: err.message },
      "Presence is counted in memory while Redis is unavailable"
    );
  }

  memoryAdd(userId, socketId, expires) {
    const sockets = this.memory.get(userId) ?? new Map();
    this.memory.set(userId, sockets);
    sockets.set(socketId, expires);
    return this.memoryCount(userId);
  }

  memoryCount(userId, now = Date.now()) {
    const sockets = this.memory.get(userId);
    if (!sockets) return 0;
    for (const [id, expires] of sockets) {
      if (expires <= now) sockets.delete(id);
    }
    if (!sockets.size) this.memory.delete(userId);
    return sockets.size;
  }

  // Counts a new connection. `first` is true when it is the user's only one.
  async connected(userId, socketId) {
    const now = Date.now();
    const expires = now + this.ttlMs;
    const client = this.client();
    if (client) {
      try {
        const count = await client.eval(ADD, {
          keys: [this.key(userId)],
          arguments: [
            String(now),
            String(expires),
            socketId,
            String(this.ttlMs),
          ],
        });
        this.where.set(socketId, "redis");
        this.warned = false;
        return { first: Number(count) === 1 };
      } catch (err) {
        this.failed(err);
      }
    }
    this.where.set(socketId, "memory");
    return { first: this.memoryAdd(userId, socketId, expires) === 1 };
  }

  // Keeps an open connection counted.
  async heartbeat(userId, socketId) {
    const expires = Date.now() + this.ttlMs;
    if (this.where.get(socketId) === "redis") {
      const client = this.client();
      if (!client) return;
      try {
        const key = this.key(userId);
        await client.zAdd(key, { score: expires, value: socketId });
        await client.pExpire(key, this.ttlMs);
      } catch (err) {
        this.failed(err);
      }
    } else if (this.memory.get(userId)?.has(socketId)) {
      this.memory.get(userId).set(socketId, expires);
    }
  }

  // Stops counting a connection. `last` is true when the user has no other.
  async disconnected(userId, socketId) {
    const backend = this.where.get(socketId);
    this.where.delete(socketId);

    if (backend === "redis") {
      const client = this.client();
      if (client) {
        try {
          const count = await client.eval(REMOVE, {
            keys: [this.key(userId)],
            arguments: [String(Date.now()), socketId],
          });
          return { last: Number(count) === 0 };
        } catch (err) {
          this.failed(err);
        }
      }
      // Redis is gone; the connection's entry expires there on its own.
      return { last: false };
    }

    this.memory.get(userId)?.delete(socketId);
    return { last: this.memoryCount(userId) === 0 };
  }

  // The ids (of those given) with at least one open connection.
  async online(userIds) {
    const result = new Set();
    const now = Date.now();
    for (const id of userIds) {
      if (this.memoryCount(id, now) > 0) result.add(id);
    }

    const client = this.client();
    const rest = userIds.filter((id) => !result.has(id));
    if (client && rest.length) {
      try {
        const multi = client.multi();
        for (const id of rest) multi.zCount(this.key(id), `(${now}`, "+inf");
        const counts = await multi.exec();
        rest.forEach((id, i) => {
          if (Number(counts[i]) > 0) result.add(id);
        });
      } catch (err) {
        this.failed(err);
      }
    }
    return result;
  }

  // Forgets everything this process knows (for tests and shutdown).
  reset() {
    this.memory.clear();
    this.where.clear();
    this.warned = false;
  }
}

export const presence = new PresenceTracker();

// Presence updates that are still running, so a shutdown (or a test) can wait
// for them before closing the database.
const pending = new Set();
export const trackPresence = (promise) => {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
};
export const settlePresence = () => Promise.allSettled([...pending]);

// Called when a user's last connection closes.
export const recordLastSeen = (userId) =>
  User.updateOne({ _id: userId }, { lastSeenAt: new Date() });

// Online state and last seen time for the users `viewerId` may see: themselves,
// people they share a chat with and people they follow. Anyone else is left
// out, so the answer does not tell whether such a user exists or is online.
export async function getPresence(viewerId, ids) {
  const wanted = [...new Set(ids)];
  const visible = new Set(wanted.filter((id) => id === viewerId.toString()));

  const [chats, follows] = await Promise.all([
    Chat.find({
      $and: [
        { members: viewerId },
        { members: mongoose.trusted({ $in: wanted }) },
      ],
    }).select("members"),
    Follow.find({
      follower: viewerId,
      following: mongoose.trusted({ $in: wanted }),
    }).select("following"),
  ]);
  const asked = new Set(wanted);
  for (const chat of chats) {
    for (const member of chat.members) {
      if (asked.has(member.toString())) visible.add(member.toString());
    }
  }
  for (const follow of follows) visible.add(follow.following.toString());

  const users = await User.find({
    _id: mongoose.trusted({ $in: [...visible] }),
  }).select("lastSeenAt");
  const byId = new Map(users.map((user) => [user.id, user]));
  const known = wanted.filter((id) => byId.has(id));
  const online = await presence.online(known);

  return known.map((id) => {
    const isOnline = online.has(id);
    return {
      userId: id,
      online: isOnline,
      lastSeen: isOnline ? null : (byId.get(id).lastSeenAt ?? null),
    };
  });
}
