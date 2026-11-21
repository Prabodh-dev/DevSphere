import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestRedis } from "./helpers/redis.js";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/users.js";
import { withEnv } from "./helpers/config.js";
import { captureLogs } from "./helpers/logs.js";
import { PresenceTracker } from "../services/presenceService.js";
import User from "../models/User.js";

let server;
let other;
let redis;
let alice;
let bob;
const key = (user = alice) =>
  `${process.env.REDIS_KEY_PREFIX}presence:${user.id}`;
const connections = async (user = alice) => redis.zCard(key(user));

async function waitFor(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(50);
  }
  return false;
}

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  redis = createTestRedis();
  await redis.connect();
  server = await startSocketServer();
  other = await startSocketServer();
  // The servers connect to Redis in the background.
  await sleep(300);
});

afterAll(async () => {
  await redis.del([key(alice), key(bob)]);
  await redis.quit();
  await server.close();
  await other.close();
  await disconnectTestDb();
});

describe("online presence in Redis", () => {
  it("is kept under this run's key prefix, one entry per connection", async () => {
    expect(process.env.REDIS_KEY_PREFIX).toMatch(/^test:[0-9a-f]{8}:$/);

    const first = await server.client(alice);
    expect(await waitFor(async () => (await connections()) === 1)).toBe(true);
    // Nothing is written to an unprefixed key.
    expect(await redis.exists(`presence:${alice.id}`)).toBe(0);

    const second = await other.client(alice);
    expect(await waitFor(async () => (await connections()) === 2)).toBe(true);

    first.close();
    expect(await waitFor(async () => (await connections()) === 1)).toBe(true);
    second.close();
    expect(await waitFor(async () => (await connections()) === 0)).toBe(true);
  });

  it("announces a user once, when the first connection opens", async () => {
    const watcher = await server.client(bob);
    const online = once(watcher, "user-online");
    const first = await server.client(alice);
    expect(await online).toBe(alice.id);

    // More tabs, on this or another instance, are not news.
    const quiet = never(watcher, "user-online", 500);
    const second = await other.client(alice);
    const third = await server.client(alice);
    expect(await quiet).toBe(true);

    // Neither is closing a tab while another is open.
    const stillHere = never(watcher, "user-offline", 500);
    first.close();
    second.close();
    expect(await stillHere).toBe(true);

    const offline = once(watcher, "user-offline");
    third.close();
    expect(await offline).toBe(alice.id);
    watcher.close();
    expect(await waitFor(async () => (await connections(bob)) === 0)).toBe(
      true
    );
  });

  it("stores when the last connection closed", async () => {
    await User.updateOne({ _id: bob.id }, { $unset: { lastSeenAt: 1 } });
    const a = await server.client(bob);
    const b = await other.client(bob);

    a.close();
    await sleep(300);
    expect((await User.findById(bob.id)).lastSeenAt).toBeUndefined();

    const before = Date.now();
    b.close();
    expect(
      await waitFor(async () => (await User.findById(bob.id)).lastSeenAt)
    ).toBeTruthy();
    const seen = (await User.findById(bob.id)).lastSeenAt.getTime();
    expect(seen).toBeGreaterThanOrEqual(before - 50);
    expect(seen).toBeLessThanOrEqual(Date.now());
  });
});

describe("PresenceTracker", () => {
  const ids = () => [alice.id, bob.id];

  it("counts connections per user and tells the first and the last", async () => {
    const tracker = new PresenceTracker();
    expect(await tracker.connected(alice.id, "s1")).toEqual({ first: true });
    expect(await tracker.connected(alice.id, "s2")).toEqual({ first: false });
    expect([...(await tracker.online(ids()))]).toEqual([alice.id]);

    expect(await tracker.disconnected(alice.id, "s1")).toEqual({ last: false });
    expect([...(await tracker.online(ids()))]).toEqual([alice.id]);
    expect(await tracker.disconnected(alice.id, "s2")).toEqual({ last: true });
    expect((await tracker.online(ids())).size).toBe(0);
    await redis.del(key(alice));
  });

  it("shares the count between trackers (instances) through Redis", async () => {
    const one = new PresenceTracker();
    const two = new PresenceTracker();
    await one.connected(alice.id, "on-one");
    // The other instance sees the user, and is not the first.
    expect([...(await two.online([alice.id]))]).toEqual([alice.id]);
    expect(await two.connected(alice.id, "on-two")).toEqual({ first: false });

    expect(await one.disconnected(alice.id, "on-one")).toEqual({ last: false });
    expect(await two.disconnected(alice.id, "on-two")).toEqual({ last: true });
    await redis.del(key(alice));
  });

  it("drops connections that stop sending heartbeats, such as after a crash", async () => {
    const tracker = new PresenceTracker({ ttlMs: 300 });
    await tracker.connected(alice.id, "lost");
    expect((await tracker.online([alice.id])).size).toBe(1);

    await sleep(450);
    expect((await tracker.online([alice.id])).size).toBe(0);
    // A new connection is the first again.
    expect(await tracker.connected(alice.id, "new")).toEqual({ first: true });

    // A heartbeat keeps a connection alive.
    await sleep(200);
    await tracker.heartbeat(alice.id, "new");
    await sleep(200);
    expect((await tracker.online([alice.id])).size).toBe(1);
    await tracker.disconnected(alice.id, "new");
  });

  it("counts in memory without Redis", async () => {
    await withEnv({ REDIS_URL: "" }, async () => {
      const tracker = new PresenceTracker();
      expect(await tracker.connected(alice.id, "a")).toEqual({ first: true });
      expect(await tracker.connected(alice.id, "b")).toEqual({ first: false });
      expect((await tracker.online([alice.id])).has(alice.id)).toBe(true);
      expect(await tracker.disconnected(alice.id, "a")).toEqual({
        last: false,
      });
      expect(await tracker.disconnected(alice.id, "b")).toEqual({ last: true });
      expect((await tracker.online([alice.id])).size).toBe(0);
    });
  });

  it("falls back to memory, with one warning, when Redis fails", async () => {
    const broken = () => ({
      eval: async () => {
        throw new Error("connection lost");
      },
      multi: () => {
        throw new Error("connection lost");
      },
    });
    const logs = captureLogs("trace");
    try {
      const tracker = new PresenceTracker({ getClient: broken });
      expect(await tracker.connected(alice.id, "a")).toEqual({ first: true });
      expect(await tracker.connected(bob.id, "b")).toEqual({ first: true });
      expect((await tracker.online(ids())).size).toBe(2);
      await tracker.disconnected(alice.id, "a");
      expect([...(await tracker.online(ids()))]).toEqual([bob.id]);

      expect(logs.lines.filter((l) => l.level === "warn")).toHaveLength(1);
    } finally {
      logs.stop();
    }
  });
});
