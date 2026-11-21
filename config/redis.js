// config/redis.js
// Redis is optional: it is only used for online-presence tracking, so the
// app keeps working (and keeps trying to reconnect) when it is unavailable.
import { createClient } from "redis";
import { config } from "./index.js";
import { logger } from "../utils/logger.js";

let redisClient = null;
let initialised = false;
let warned = false;
// Extra connections (the Socket.IO adapter's publisher and subscriber), closed
// together with the shared client.
const extraClients = new Set();

const buildClient = (url) => {
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  client.on("error", (err) => {
    // Log once per outage instead of on every reconnect attempt.
    if (!warned) {
      logger.warn(
        { err: err.message },
        "Redis unavailable, continuing without it"
      );
      warned = true;
    }
  });
  client.on("ready", () => {
    warned = false;
    logger.info("Connected to Redis");
  });
  return client;
};

// Starts connecting in the background and returns immediately.
export const initRedis = () => {
  if (initialised) return redisClient;
  initialised = true;

  const url = config.redis.url;
  if (!url) {
    logger.warn("REDIS_URL is not set, online presence tracking is disabled");
    return null;
  }

  redisClient = buildClient(url);
  redisClient.connect().catch((err) => {
    logger.warn({ err: err.message }, "Redis connection failed");
  });

  return redisClient;
};

// The adapter sends commands without waiting for them, so a failure (a closed
// connection, a command dropped on shutdown) would be an unhandled rejection.
// Failures are logged instead.
const guarded = (client) =>
  new Proxy(client, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...args) => {
        const result = value.apply(target, args);
        result?.catch?.((err) => {
          logger.debug({ err: err.message }, "Redis adapter command failed");
        });
        return result;
      };
    },
  });

// A publisher and a subscriber for the Socket.IO adapter, or null without a
// Redis URL. They connect in the background and keep retrying.
export const createAdapterClients = () => {
  const url = config.redis.url;
  if (!url) return null;

  const pub = buildClient(url);
  // Not pub.duplicate(): a duplicate does not inherit the error handler.
  const sub = buildClient(url);
  for (const client of [pub, sub]) {
    extraClients.add(client);
    client.connect().catch((err) => {
      logger.warn({ err: err.message }, "Redis connection failed");
    });
  }
  return { pub: guarded(pub), sub: guarded(sub), raw: [pub, sub] };
};

// Closes the adapter's connections once its server has shut down.
export const closeAdapterClients = async ({ raw }) => {
  for (const client of raw) extraClients.delete(client);
  await Promise.all(raw.map(closeClient));
};

// Returns the client only while it is connected.
export const getRedisClient = () =>
  redisClient && redisClient.isReady ? redisClient : null;

// "disabled" without a Redis URL, "up" while connected, otherwise "down".
export const getRedisStatus = () => {
  if (!config.redis.url) return "disabled";
  return getRedisClient() ? "up" : "down";
};

const closeClient = async (client) => {
  if (!client.isOpen) return;
  try {
    if (client.isReady) await client.quit();
    else client.destroy();
  } catch (err) {
    logger.warn({ err: err.message }, "Error while closing Redis");
  }
};

export const closeRedis = async () => {
  const clients = [...extraClients];
  extraClients.clear();
  if (redisClient) clients.push(redisClient);
  redisClient = null;
  initialised = false;
  await Promise.all(clients.map(closeClient));
};
