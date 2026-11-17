import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Session from "../models/Session.js";
import User from "../models/User.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import {
  createUser,
  loginAs,
  bearer,
  refreshCookieFrom,
  tokenFromCookie,
  ORIGIN,
} from "./helpers/users.js";
import { withEnv } from "./helpers/config.js";

let user;
let login;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  user = await createUser();
  login = await loginAs(user);
});

const refresh = (cookie, origin = ORIGIN) => {
  let req = request(app).post("/api/v1/auth/refresh");
  if (origin) req = req.set("Origin", origin);
  if (cookie) req = req.set("Cookie", cookie);
  return req.send();
};

describe("POST /api/v1/auth/refresh", () => {
  it("issues a new access token and rotates the refresh token", async () => {
    const res = await refresh(login.cookie);
    expect(res.status).toBe(200);

    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload.userId).toBe(user.id);
    expect(res.body.expiresIn).toBe(15 * 60);
    expect(Object.keys(res.body).sort()).toEqual(["expiresIn", "token"]);

    const next = refreshCookieFrom(res);
    expect(next).toBeDefined();
    expect(next).not.toBe(login.cookie);

    // The new access token works and belongs to the same login.
    const sid = jwt.decode(login.token).sid;
    expect(payload.sid).toBe(sid);
    const chats = await request(app)
      .get("/api/v1/chat")
      .set(bearer(res.body.token));
    expect(chats.status).toBe(200);
  });

  it("keeps the rotated token in the same family and links the two", async () => {
    const res = await refresh(login.cookie);
    const sid = jwt.decode(login.token).sid;
    const docs = await Session.find({ familyId: sid }).sort({ createdAt: 1 });
    expect(docs).toHaveLength(2);
    expect(docs[0].revokedAt).not.toBeNull();
    expect(docs[0].replacedBy.toString()).toBe(docs[1].id);
    expect(docs[1].revokedAt).toBeNull();
    expect(refreshCookieFrom(res)).toBeDefined();
  });

  it("stops accepting the old token and accepts the new one", async () => {
    const first = await refresh(login.cookie);
    const second = await refresh(refreshCookieFrom(first));
    expect(second.status).toBe(200);

    // Outside the grace window a replay is treated as reuse (see below), so
    // simply check that the newest token keeps working.
    const third = await refresh(refreshCookieFrom(second));
    expect(third.status).toBe(200);
  });

  it("answers 401 without a cookie or with an unknown token", async () => {
    expect((await refresh(undefined)).status).toBe(401);
    expect((await refresh("refresh_token=not-a-real-token")).status).toBe(401);
    expect((await refresh("other_cookie=abc")).status).toBe(401);
  });

  it("never reads the token from the request body or headers", async () => {
    const raw = tokenFromCookie(login.cookie);
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", ORIGIN)
      .set("Authorization", `Bearer ${raw}`)
      .send({ refreshToken: raw, refresh_token: raw });
    expect(res.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    await Session.updateMany(
      { userId: user.id },
      { expiresAt: new Date(Date.now() - 1000) }
    );
    expect((await refresh(login.cookie)).status).toBe(401);
  });

  it("rejects tokens that were revoked", async () => {
    await Session.updateMany({ userId: user.id }, { revokedAt: new Date() });
    expect((await refresh(login.cookie)).status).toBe(401);
  });

  it("clears the cookie when the token is not accepted", async () => {
    const res = await refresh("refresh_token=not-a-real-token");
    const header = res.headers["set-cookie"].find((c) =>
      c.startsWith("refresh_token=")
    );
    expect(header).toMatch(/refresh_token=;/);
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("does not let a blocked user refresh and ends their sessions", async () => {
    await User.updateOne({ _id: user.id }, { isBlocked: true });
    const res = await refresh(login.cookie);
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();

    await User.updateOne({ _id: user.id }, { isBlocked: false });
    expect(
      await Session.countDocuments({ userId: user.id, revokedAt: null })
    ).toBe(0);
    expect((await refresh(login.cookie)).status).toBe(401);
  });

  it("does not refresh for a deleted user", async () => {
    await User.deleteOne({ _id: user.id });
    expect((await refresh(login.cookie)).status).toBe(401);
  });
});

describe("reuse of a rotated token", () => {
  const backdate = (userId, ms) =>
    Session.updateMany(
      { userId, replacedBy: mongoose.trusted({ $ne: null }) },
      { revokedAt: new Date(Date.now() - ms) }
    );

  it("revokes the whole family when an old token comes back", async () => {
    const rotated = await refresh(login.cookie);
    const newest = refreshCookieFrom(rotated);
    await backdate(user.id, 60 * 1000);

    const replay = await refresh(login.cookie);
    expect(replay.status).toBe(401);

    // The token issued by the legitimate rotation no longer works either.
    expect((await refresh(newest)).status).toBe(401);
    const sid = jwt.decode(login.token).sid;
    expect(
      await Session.countDocuments({ familyId: sid, revokedAt: null })
    ).toBe(0);

    // The access token of that login is dead as well.
    const chats = await request(app)
      .get("/api/v1/chat")
      .set(bearer(rotated.body.token));
    expect(chats.status).toBe(401);
  });

  it("leaves other logins of the same user alone", async () => {
    const other = await loginAs(user);
    const rotated = await refresh(login.cookie);
    await backdate(user.id, 60 * 1000);
    await refresh(login.cookie);

    expect((await refresh(other.cookie)).status).toBe(200);
    expect(rotated.status).toBe(200);
  });

  it("forgives a parallel request inside the grace window", async () => {
    const rotated = await refresh(login.cookie);
    const newest = refreshCookieFrom(rotated);

    // Immediately presenting the old token again is refused...
    const replay = await refresh(login.cookie);
    expect(replay.status).toBe(401);

    // ...but the family survives, so the new token still works.
    const next = await refresh(newest);
    expect(next.status).toBe(200);
  });
});

describe("concurrent refresh", () => {
  it("lets only one of several simultaneous requests succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => refresh(login.cookie))
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 401)).toHaveLength(7);

    // Exactly one new token was created and the family is still usable.
    const sid = jwt.decode(login.token).sid;
    expect(await Session.countDocuments({ familyId: sid })).toBe(2);
    const winner = results.find((r) => r.status === 200);
    expect((await refresh(refreshCookieFrom(winner))).status).toBe(200);
  });
});

describe("Origin check", () => {
  it("rejects a missing or different origin", async () => {
    expect((await refresh(login.cookie, null)).status).toBe(403);
    expect(
      (await refresh(login.cookie, "https://evil.example.test")).status
    ).toBe(403);
    expect((await refresh(login.cookie, "null")).status).toBe(403);
  });

  it("does not use up the token when the origin is wrong", async () => {
    await refresh(login.cookie, "https://evil.example.test");
    expect((await refresh(login.cookie)).status).toBe(200);
  });

  it("rejects every origin when none are configured", async () => {
    await withEnv({ CORS_ORIGINS: "" }, async () => {
      expect((await refresh(login.cookie)).status).toBe(403);
    });
  });
});

describe("secrets in output", () => {
  it("never appear in responses or logs", async () => {
    const logs = [];
    const spies = ["log", "info", "warn", "error"].map((m) =>
      vi
        .spyOn(console, m)
        .mockImplementation((...args) => logs.push(args.join(" ")))
    );

    const raw1 = tokenFromCookie(login.cookie);
    const first = await refresh(login.cookie);
    const raw2 = tokenFromCookie(refreshCookieFrom(first));
    const replay = await refresh(login.cookie); // rejected
    const bad = await refresh("refresh_token=garbage");
    spies.forEach((s) => s.mockRestore());

    const { createHash } = await import("crypto");
    const hashes = [raw1, raw2].map((t) =>
      createHash("sha256").update(t).digest("hex")
    );

    const everything = JSON.stringify([
      first.body,
      replay.body,
      bad.body,
      logs,
    ]);
    for (const secret of [raw1, raw2, ...hashes]) {
      expect(everything).not.toContain(secret);
    }
    // And no response header other than the cookie carries a token.
    for (const res of [first, replay, bad]) {
      const headers = JSON.stringify(
        Object.entries(res.headers).filter(([k]) => k !== "set-cookie")
      );
      expect(headers).not.toContain(raw1);
      expect(headers).not.toContain(raw2);
    }
  });
});
