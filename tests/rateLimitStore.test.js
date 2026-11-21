import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { rateLimit } from "express-rate-limit";
import request from "supertest";
import { SharedStore } from "../utils/rateLimitStore.js";
import { createLimiters } from "../middlewares/rateLimit.js";
import { closeRedis, getRedisClient, initRedis } from "../config/redis.js";
import { withEnv } from "./helpers/config.js";
import { captureLogs } from "./helpers/logs.js";
import { sleep } from "./helpers/socket.js";

const prefix = () => process.env.REDIS_KEY_PREFIX;

async function redisReady(ms = 5000) {
  initRedis();
  const deadline = Date.now() + ms;
  while (!getRedisClient() && Date.now() < deadline) await sleep(25);
  expect(getRedisClient()).not.toBeNull();
}

const newStore = (name, options = {}) => {
  const store = new SharedStore({ name, ...options });
  store.init({ windowMs: 60 * 1000 });
  return store;
};

afterAll(closeRedis);

describe("rate limit store without Redis", () => {
  it("counts in memory, quietly", async () => {
    await withEnv({ REDIS_URL: "" }, async () => {
      const logs = captureLogs("trace");
      try {
        const store = newStore("memory-only");
        expect((await store.increment("a")).totalHits).toBe(1);
        expect((await store.increment("a")).totalHits).toBe(2);
        expect((await store.increment("b")).totalHits).toBe(1);

        await store.decrement("a");
        expect((await store.get("a")).totalHits).toBe(1);
        await store.resetKey("a");
        expect((await store.increment("a")).totalHits).toBe(1);
        expect(logs.lines.filter((l) => l.level === "warn")).toEqual([]);
      } finally {
        logs.stop();
      }
    });
  });
});

describe("rate limit store with Redis", () => {
  beforeAll(() => redisReady());

  it("shares counters between instances", async () => {
    const one = newStore("shared");
    const two = newStore("shared");

    expect((await one.increment("user")).totalHits).toBe(1);
    expect((await two.increment("user")).totalHits).toBe(2);
    expect((await one.increment("user")).totalHits).toBe(3);
    expect((await two.get("user")).totalHits).toBe(3);

    await two.decrement("user");
    expect((await one.get("user")).totalHits).toBe(2);
    await one.resetKey("user");
    expect(await two.get("user")).toBeUndefined();
  });

  it("keeps limiters and keys apart, under this run's prefix", async () => {
    const one = newStore("first-limiter");
    const two = newStore("second-limiter");
    await one.increment("k");
    expect((await two.increment("k")).totalHits).toBe(1);

    const client = getRedisClient();
    expect(await client.exists(`${prefix()}rl:first-limiter:k`)).toBe(1);
    expect(await client.exists("rl:first-limiter:k")).toBe(0);
  });

  it("expires counters after the window", async () => {
    const store = new SharedStore({ name: "short" });
    store.init({ windowMs: 300 });
    expect((await store.increment("k")).totalHits).toBe(1);
    expect((await store.increment("k")).totalHits).toBe(2);
    const ttl = await getRedisClient().pTTL(`${prefix()}rl:short:k`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(300);

    await sleep(400);
    expect((await store.increment("k")).totalHits).toBe(1);
  });

  it("limits requests across two app instances", async () => {
    // Two limiter sets stand for two running instances.
    const makeApp = () => {
      const limiters = createLimiters({ generalMax: 3 });
      const app = express();
      app.use(limiters.general);
      app.get("/ping", (req, res) => res.send("ok"));
      return app;
    };
    const first = makeApp();
    const second = makeApp();

    const statuses = [];
    for (const app of [first, second, first, second, first]) {
      statuses.push((await request(app).get("/ping")).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});

describe("stacked limiters", () => {
  beforeAll(() => redisReady());

  it("count a request once in each without a double count warning", async () => {
    const problems = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const limiters = createLimiters({ generalMax: 10, authMax: 10 });
      const app = express();
      app.use(limiters.general);
      app.use("/login", limiters.auth, (req, res) => res.send("ok"));

      for (let i = 0; i < 3; i++) {
        expect((await request(app).get("/login")).status).toBe(200);
      }
      expect(problems).not.toHaveBeenCalled();
    } finally {
      problems.mockRestore();
    }
  });
});

describe("rate limit store fallback", () => {
  const failing = () => ({
    eval: async () => {
      throw new Error("connection lost");
    },
    get: async () => {
      throw new Error("connection lost");
    },
    decr: async () => {},
    del: async () => {},
    pTTL: async () => -1,
  });

  it("counts in memory and warns once when Redis fails", async () => {
    const logs = captureLogs("trace");
    try {
      const store = newStore("failing", { getClient: failing });
      // A Redis URL is configured, so a failure is a fallback.
      expect(process.env.REDIS_URL).toBeTruthy();

      expect((await store.increment("k")).totalHits).toBe(1);
      expect((await store.increment("k")).totalHits).toBe(2);
      expect((await store.increment("k")).totalHits).toBe(3);

      const warnings = logs.lines.filter((l) => l.level === "warn");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        limiter: "failing",
        reason: "connection lost",
      });
    } finally {
      logs.stop();
    }
  });

  it("does not block requests while Redis is down", async () => {
    const store = newStore("http-down", { getClient: () => null });
    const app = express();
    app.use(rateLimit({ windowMs: 60000, limit: 2, store }));
    app.get("/ping", (req, res) => res.send("ok"));

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await request(app).get("/ping")).status);
    }
    // Still limited, from the in-memory counters, and not blocked outright.
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("warns that Redis is not connected, and goes back to sharing when it returns", async () => {
    const logs = captureLogs("trace");
    try {
      let client = null;
      const store = newStore("recovering", { getClient: () => client });

      expect((await store.increment("k")).totalHits).toBe(1);
      expect((await store.increment("k")).totalHits).toBe(2);
      const warnings = logs.lines.filter((l) => l.level === "warn");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].reason).toBe("Redis is not connected");

      await redisReady();
      client = getRedisClient();
      // Counting continues in Redis, from a fresh counter.
      expect((await store.increment("k")).totalHits).toBe(1);
      expect(
        logs.lines.some((l) => l.msg.includes("shared through Redis"))
      ).toBe(true);
    } finally {
      logs.stop();
    }
  });
});
