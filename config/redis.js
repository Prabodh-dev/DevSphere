// config/redis.js
// Redis is optional: it is only used for online-presence tracking, so the
// app keeps working (and keeps trying to reconnect) when it is unavailable.
import { createClient } from "redis";
import { config } from "./index.js";
import { logger } from "../utils/logger.js";

let redisClient = null;
let initialised = false;
let warned = false;

// Starts connecting in the background and returns immediately.
export const initRedis = () => {
  if (initialised) return redisClient;
  initialised = true;

  const url = config.redis.url;
  if (!url) {
    logger.warn("REDIS_URL is not set, online presence tracking is disabled");
    return null;
  }

  redisClient = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  redisClient.on("error", (err) => {
    // Log once per outage instead of on every reconnect attempt.
    if (!warned) {
      logger.warn(
        { err: err.message },
        "Redis unavailable, continuing without it"
      );
      warned = true;
    }
  });
  redisClient.on("ready", () => {
    warned = false;
    logger.info("Connected to Redis");
  });

  redisClient.connect().catch((err) => {
    logger.warn({ err: err.message }, "Redis connection failed");
  });

  return redisClient;
};

// Returns the client only while it is connected.
export const getRedisClient = () =>
  redisClient && redisClient.isReady ? redisClient : null;

export const closeRedis = async () => {
  if (!redisClient) return;
  try {
    if (redisClient.isReady) await redisClient.quit();
    else redisClient.destroy();
  } catch (err) {
    logger.warn({ err: err.message }, "Error while closing Redis");
  }
  redisClient = null;
  initialised = false;
};
