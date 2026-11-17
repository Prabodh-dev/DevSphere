import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import app from "../app.js";
import { closeRedis, initRedis } from "../config/redis.js";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";
import { withEnv } from "./helpers/config.js";
import { sleep } from "./helpers/socket.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

afterAll(async () => {
  await closeRedis();
  if (mongoose.connection.readyState === 1) await disconnectTestDb();
});

async function redisReady(ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const res = await request(app).get("/readyz");
    if (res.body.redis === "up") return true;
    await sleep(50);
  }
  return false;
}

describe("GET /readyz", () => {
  it("answers 503 while MongoDB is not connected", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "unavailable", db: "down" });
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("answers 200 once MongoDB is connected, and reports Redis as a field", async () => {
    await connectTestDb();

    const before = await request(app).get("/readyz");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ status: "ok", db: "up", redis: "down" });

    initRedis();
    expect(await redisReady()).toBe(true);
    const up = await request(app).get("/readyz");
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ status: "ok", db: "up", redis: "up" });
  });

  it("reports Redis as disabled when no URL is set, and stays ready", async () => {
    await withEnv({ REDIS_URL: "" }, async () => {
      await closeRedis();
      const res = await request(app).get("/readyz");
      expect(res.status).toBe(200);
      expect(res.body.redis).toBe("disabled");
    });
  });

  it("is ready without Redis: only MongoDB decides", async () => {
    await closeRedis();
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.redis).toBe("down");
  });

  it("needs no token and is not versioned", async () => {
    expect((await request(app).get("/readyz")).status).toBe(200);
    expect((await request(app).get("/api/v1/readyz")).status).toBe(404);
  });

  it("goes back to 503 when MongoDB goes away", async () => {
    await disconnectTestDb();
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.db).toBe("down");
  });
});

describe("GET /healthz", () => {
  it("is unchanged: process up, database state, no Redis field", async () => {
    const down = await request(app).get("/healthz");
    expect(down.status).toBe(503);
    expect(down.body).toEqual({ status: "unavailable", db: "down" });

    await connectTestDb();
    const up = await request(app).get("/healthz");
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ status: "ok", db: "up" });
  });
});

describe("Docker healthcheck", () => {
  it("asks whether the app is ready", () => {
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
    const check = dockerfile
      .split("\n")
      .filter((line) => /HEALTHCHECK|\/readyz|\/healthz/.test(line));
    expect(check.join("\n")).toContain("/readyz");
    expect(check.join("\n")).not.toContain("/healthz");
  });
});
