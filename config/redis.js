// config/redis.js
import { createClient } from "redis";
import dotenv from "dotenv";
dotenv.config();

let redisClient;

export const initRedis = async () => {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
      },
    });

    redisClient.on("error", (err) => {
      console.error("❌ Redis Client Error:", err.message);
    });

    try {
      await redisClient.connect();
      console.log("✅ Connected to Upstash Redis");
    } catch (err) {
      console.error("❌ Redis Connection Failed:", err.message);
    }
  }
};

export const getRedisClient = () => redisClient;
