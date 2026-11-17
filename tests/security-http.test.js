import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";

// Settings are read when the app is created, so set them before importing it.
process.env.CORS_ORIGINS = "https://app.example.test";
process.env.AUTH_RATE_LIMIT_MAX = "3";
process.env.HIGHLIGHT_RATE_LIMIT_MAX = "2";
process.env.RATE_LIMIT_MAX = "1000";

const { default: app } = await import("../app.js");
const { createLimiters } = await import("../middlewares/rateLimit.js");

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe("headers", () => {
  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });
});

describe("CORS", () => {
  it("allows only configured origins", async () => {
    const allowed = await request(app)
      .get("/healthz")
      .set("Origin", "https://app.example.test");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://app.example.test"
    );

    const other = await request(app)
      .get("/healthz")
      .set("Origin", "https://other.example.test");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never answers with a wildcard", async () => {
    const res = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", "https://app.example.test")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });
});

describe("request size", () => {
  it("rejects very large JSON bodies", async () => {
    const res = await request(app)
      .post("/api/v1/snippets/highlight")
      .send({ code: "a".repeat(400 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error).toEqual({
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body too large",
      requestId: res.headers["x-request-id"],
    });
  });

  it("caps the size of snippets that are highlighted", async () => {
    const res = await request(app)
      .post("/api/v1/snippets/highlight")
      .send({ code: "a".repeat(20001) });
    expect(res.status).toBe(400);
  });
});

describe("rate limits", () => {
  it("limits login and register attempts", async () => {
    const attempt = () =>
      request(app)
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.test", password: "whatever-1" });

    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt()).status);

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);

    const blocked = await attempt();
    expect(blocked.body.error).toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
    });
    expect(
      blocked.headers["ratelimit"] ?? blocked.headers["ratelimit-policy"]
    ).toBeDefined();

    // Registration shares the same strict limiter.
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "x", email: "x", password: "x" });
    expect(reg.status).toBe(429);
  });

  it("limits the public highlighter", async () => {
    const call = () =>
      request(app)
        .post("/api/v1/snippets/highlight")
        .send({ code: "let a = 1;", language: "javascript" });

    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call()).status);

    // Earlier requests in this file already used part of the allowance.
    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(2);
  });

  it("applies a general limit through the shared factory", async () => {
    const limiters = createLimiters({ generalMax: 2 });
    const mini = express();
    mini.use(limiters.general);
    mini.get("/ping", (req, res) => res.json({ ok: true }));

    expect((await request(mini).get("/ping")).status).toBe(200);
    expect((await request(mini).get("/ping")).status).toBe(200);
    expect((await request(mini).get("/ping")).status).toBe(429);
  });
});
