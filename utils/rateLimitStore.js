import { MemoryStore } from "express-rate-limit";
import { config } from "../config/index.js";
import { getRedisClient } from "../config/redis.js";
import { logger } from "./logger.js";

// Adds a hit to a counter that expires after the window. Redis does this in
// one step, so instances cannot interleave.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

// A rate limit store for express-rate-limit (and for the socket limiter).
//
// With Redis the counters are shared by every app instance. Without it, or
// while Redis is unreachable, each instance counts on its own in memory, and a
// warning is logged once per outage. Traffic is never blocked because Redis is
// down.
export class SharedStore {
  // name keeps the counters of different limiters apart.
  // getClient returns a connected Redis client, or null.
  constructor({ name, getClient = getRedisClient }) {
    this.name = name;
    // Tells express-rate-limit that this store is not shared with another
    // limiter, so one request may count once in each.
    this.prefix = `${name}:`;
    this.getClient = getClient;
    this.memory = new MemoryStore();
    this.degraded = false;
    this.windowMs = 60 * 1000;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  redisKey(key) {
    return `${config.redis.keyPrefix}rl:${this.name}:${key}`;
  }

  // The Redis client to use, or null for the in-memory counters.
  client() {
    // Without a Redis URL, memory is the plan and not a fallback.
    if (!config.redis.url) return null;
    const client = this.getClient();
    if (!client) this.fallBack("Redis is not connected");
    return client;
  }

  fallBack(reason) {
    if (this.degraded) return;
    this.degraded = true;
    logger.warn(
      { limiter: this.name, reason },
      "Rate limits are counted in memory while Redis is unavailable"
    );
  }

  recovered() {
    if (!this.degraded) return;
    this.degraded = false;
    logger.info({ limiter: this.name }, "Rate limits are shared through Redis");
  }

  // Runs the Redis version of an operation, or the memory version when Redis
  // is not there or fails.
  async run(viaRedis, viaMemory) {
    const client = this.client();
    if (!client) return viaMemory();
    try {
      const result = await viaRedis(client);
      this.recovered();
      return result;
    } catch (err) {
      this.fallBack(err.message);
      return viaMemory();
    }
  }

  increment(key) {
    return this.run(
      async (client) => {
        const [totalHits, ttl] = await client.eval(INCREMENT, {
          keys: [this.redisKey(key)],
          arguments: [String(this.windowMs)],
        });
        return {
          totalHits: Number(totalHits),
          resetTime: new Date(Date.now() + Number(ttl)),
        };
      },
      () => this.memory.increment(key)
    );
  }

  decrement(key) {
    return this.run(
      async (client) => {
        const redisKey = this.redisKey(key);
        if (Number(await client.get(redisKey)) > 0) await client.decr(redisKey);
      },
      () => this.memory.decrement(key)
    );
  }

  resetKey(key) {
    return this.run(
      async (client) => {
        await client.del(this.redisKey(key));
      },
      () => this.memory.resetKey(key)
    );
  }

  get(key) {
    return this.run(
      async (client) => {
        const redisKey = this.redisKey(key);
        const hits = Number(await client.get(redisKey));
        if (!hits) return undefined;
        const ttl = await client.pTTL(redisKey);
        return {
          totalHits: hits,
          resetTime: new Date(Date.now() + Math.max(ttl, 0)),
        };
      },
      () => this.memory.get(key)
    );
  }
}
