import { createClient } from "redis";

// A Redis client for a test. Without an error handler a client that loses its
// connection prints a warning (or, in older versions, throws), so every client
// a test creates gets one. The caller connects and closes it.
export function createTestRedis() {
  const client = createClient({ url: process.env.REDIS_URL });
  client.on("error", () => {});
  return client;
}
