// config/redis.js
import { createClient } from "redis";
import dotenv from "dotenv";
dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});

redisClient.on("error", (err) => {
  console.error(" Redis Client Error", err);
});

await redisClient.connect();
console.log(" Connected to Upstash Redis");

export default redisClient;
