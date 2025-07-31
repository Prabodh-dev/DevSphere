// config/redis.js
import { createClient } from "redis";
import dotenv from "dotenv";
dotenv.config();

let redisClient;

export async function initRedis() {
  if (redisClient) return redisClient;

  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  redisClient.on("error", (err) => {
    console.error("Redis Client Error", err);
  });

  try {
    await redisClient.connect();
    console.log(" Connected to Upstash Redis");
  } catch (err) {
    console.error(" Redis connection failed", err);
  }

  return redisClient;
}

export default () => redisClient;
