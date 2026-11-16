import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import app from "../app.js";
import Session from "../models/Session.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import {
  createUser,
  loginAs,
  bearer,
  refreshCookieFrom,
  tokenFromCookie,
} from "./helpers/users.js";

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearTestDb);

describe("login", () => {
  it("returns a short-lived access token and sets the refresh cookie", async () => {
    const user = await createUser();
    const { res, cookie } = await loginAs(user, {
      "User-Agent": "test-agent/1.0",
    });

    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload.userId).toBe(user.id);
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(res.body.expiresIn).toBe(15 * 60);

    const header = res.headers["set-cookie"].find((c) =>
      c.startsWith("refresh_token=")
    );
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).toMatch(/Path=\/api\/auth(;|$)/);
    expect(header).not.toMatch(/Secure/i);
    const maxAge = Number(header.match(/Max-Age=(\d+)/i)[1]);
    expect(maxAge).toBeGreaterThan(29 * 86400);
    expect(maxAge).toBeLessThanOrEqual(30 * 86400);
    expect(cookie).toBeDefined();
  });

  it("never puts the refresh token in the response body", async () => {
    const user = await createUser();
    const { res, cookie } = await loginAs(user);
    const raw = tokenFromCookie(cookie);

    expect(JSON.stringify(res.body)).not.toContain(raw);
    expect(Object.keys(res.body).sort()).toEqual([
      "_id",
      "email",
      "expiresIn",
      "token",
      "username",
    ]);
  });

  it("marks the cookie Secure when COOKIE_SECURE is true", async () => {
    const user = await createUser();
    process.env.COOKIE_SECURE = "true";
    try {
      const { res } = await loginAs(user);
      const header = res.headers["set-cookie"].find((c) =>
        c.startsWith("refresh_token=")
      );
      expect(header).toMatch(/Secure/i);
    } finally {
      process.env.COOKIE_SECURE = "false";
    }
  });

  it("uses the configured token lifetimes", async () => {
    const user = await createUser();
    process.env.ACCESS_TOKEN_TTL = "5m";
    process.env.REFRESH_TOKEN_TTL_DAYS = "7";
    try {
      const { res } = await loginAs(user);
      const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(payload.exp - payload.iat).toBe(300);
      const header = res.headers["set-cookie"].find((c) =>
        c.startsWith("refresh_token=")
      );
      expect(Number(header.match(/Max-Age=(\d+)/i)[1])).toBeLessThanOrEqual(
        7 * 86400
      );
    } finally {
      process.env.ACCESS_TOKEN_TTL = "15m";
      process.env.REFRESH_TOKEN_TTL_DAYS = "30";
    }
  });

  it("registration signs the user in the same way", async () => {
    const res = await request(app).post("/api/auth/register").send({
      username: "fresh",
      email: "fresh@example.test",
      password: "a-good-passw0rd",
    });
    expect(res.status).toBe(201);
    expect(refreshCookieFrom(res)).toBeDefined();
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET).sid).toBeTruthy();
  });
});

describe("stored sessions", () => {
  it("keep only a hash of the refresh token", async () => {
    const user = await createUser();
    const agent = "x".repeat(500);
    const { cookie } = await loginAs(user, { "User-Agent": agent });
    const raw = tokenFromCookie(cookie);

    expect(Buffer.from(raw, "base64url").length).toBeGreaterThanOrEqual(32);

    const stored = await Session.find({ userId: user.id }).lean();
    // One for registration, one for the login above.
    expect(stored).toHaveLength(2);
    const mine = stored.find(
      (s) => s.tokenHash === createHash("sha256").update(raw).digest("hex")
    );
    expect(mine).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(raw);
    expect(mine.userAgent.length).toBeLessThanOrEqual(200);
    expect(mine.ip).toBeTruthy();
    expect(mine.revokedAt).toBeNull();
    expect(mine.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * 86400000
    );
  });

  it("have a unique hash and a TTL index", async () => {
    await Session.init();
    const indexes = await Session.collection.indexes();
    const hashIndex = indexes.find((i) => i.key.tokenHash === 1);
    expect(hashIndex.unique).toBe(true);
    const ttl = indexes.find((i) => i.key.expiresAt === 1);
    expect(ttl.expireAfterSeconds).toBe(0);
  });

  it("start a new family for every login", async () => {
    const user = await createUser();
    await loginAs(user);
    await loginAs(user);
    const families = await Session.distinct("familyId", { userId: user.id });
    expect(families).toHaveLength(3);
  });
});

describe("access tokens", () => {
  it("are rejected when they do not belong to a session", async () => {
    const user = await createUser();
    const old = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    const res = await request(app).get("/api/chat").set(bearer(old));
    expect(res.status).toBe(401);
  });

  it("stop working once their session is revoked", async () => {
    const user = await createUser();
    const ok = await request(app).get("/api/chat").set(bearer(user.token));
    expect(ok.status).toBe(200);

    await Session.updateMany({ userId: user.id }, { revokedAt: new Date() });
    const res = await request(app).get("/api/chat").set(bearer(user.token));
    expect(res.status).toBe(401);
  });
});
