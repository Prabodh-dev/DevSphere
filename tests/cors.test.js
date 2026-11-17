import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";

// Settings are read when the app is created, so set them before importing it.
process.env.CORS_ORIGINS =
  "https://app.example.test, https://admin.example.test";
process.env.AUTH_RATE_LIMIT_MAX = "2";

const { default: app } = await import("../app.js");

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

const ALLOWED = "https://app.example.test";
const OTHER = "https://other.example.test";

const list = (value) =>
  String(value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

describe("requests from an allowed origin", () => {
  it("get the origin back with credentials allowed", async () => {
    const res = await request(app).get("/api/v1/chat").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(list(res.headers.vary)).toContain("origin");
  });

  it("also get them on error responses, so the browser can read them", async () => {
    const res = await request(app).get("/api/v1/chat").set("Origin", ALLOWED);
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("can read the rate limit headers", async () => {
    const res = await request(app).get("/api/v1/chat").set("Origin", ALLOWED);
    expect(list(res.headers["access-control-expose-headers"])).toEqual(
      expect.arrayContaining(["ratelimit", "ratelimit-policy", "retry-after"])
    );
    // The headers are sent on normal responses...
    expect(res.headers.ratelimit).toBeDefined();
    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });

  it("support every configured origin", async () => {
    const res = await request(app)
      .get("/healthz")
      .set("Origin", "https://admin.example.test");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://admin.example.test"
    );
  });
});

describe("requests from other origins", () => {
  it("get no CORS headers at all", async () => {
    const res = await request(app).get("/api/v1/chat").set("Origin", OTHER);
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-expose-headers",
      "access-control-allow-headers",
    ]) {
      expect(res.headers[name], name).toBeUndefined();
    }
  });

  it("are not allowed by a look-alike origin", async () => {
    for (const origin of [
      "https://app.example.test.evil.test",
      "http://app.example.test",
      "https://app.example.test:8443",
      "null",
    ]) {
      const res = await request(app).get("/healthz").set("Origin", origin);
      expect(
        res.headers["access-control-allow-origin"],
        origin
      ).toBeUndefined();
    }
  });

  it("and requests without an Origin header get none either", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("preflight requests", () => {
  const preflight = (origin, headers = "authorization, content-type") =>
    request(app)
      .options("/api/v1/auth/refresh")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", headers);

  it("are answered for an allowed origin", async () => {
    const res = await preflight(ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(list(res.headers["access-control-allow-methods"])).toEqual(
      expect.arrayContaining(["get", "post", "patch", "delete", "options"])
    );
    expect(list(res.headers["access-control-allow-headers"])).toEqual(
      expect.arrayContaining(["authorization", "content-type"])
    );
    expect(Number(res.headers["access-control-max-age"])).toBeGreaterThan(0);
  });

  it("only allow the headers the API uses", async () => {
    const res = await preflight(ALLOWED, "x-custom-thing");
    expect(list(res.headers["access-control-allow-headers"])).not.toContain(
      "x-custom-thing"
    );
  });

  it("need no token and are not rate limited", async () => {
    for (let i = 0; i < 6; i++) {
      expect((await preflight(ALLOWED)).status).toBe(204);
    }
  });

  it("get no CORS headers for a disallowed origin", async () => {
    const res = await preflight(OTHER);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers["access-control-allow-methods"]).toBeUndefined();
    expect(res.headers["access-control-allow-headers"]).toBeUndefined();
  });
});

describe("rate limit headers", () => {
  it("include Retry-After and CORS headers when a request is limited", async () => {
    const attempt = () =>
      request(app)
        .post("/api/v1/auth/login")
        .set("Origin", ALLOWED)
        .send({ email: "nobody@example.test", password: "whatever-1" });

    await attempt();
    await attempt();
    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(limited.body.error.details).toEqual({
      retryAfterSeconds: retryAfter,
    });
    expect(limited.headers.ratelimit).toBeDefined();
    expect(limited.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });
});
