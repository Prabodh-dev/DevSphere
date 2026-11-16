import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Session from "../models/Session.js";
import User from "../models/User.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import {
  createUser,
  loginAs,
  makeAdmin,
  bearer,
  refreshCookieFrom,
  ORIGIN,
} from "./helpers/users.js";

let user;
let phone;
let laptop;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  user = await createUser();
  phone = await loginAs(user, { "User-Agent": "Phone/1.0" });
  laptop = await loginAs(user, { "User-Agent": "Laptop/2.0" });
});

const refresh = (cookie) =>
  request(app)
    .post("/api/auth/refresh")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send();

const sidOf = (login) => jwt.decode(login.token).sid;

describe("POST /api/auth/logout", () => {
  it("revokes the login and clears the cookie", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", ORIGIN)
      .set("Cookie", phone.cookie);
    expect(res.status).toBe(200);

    const cleared = res.headers["set-cookie"].find((c) =>
      c.startsWith("refresh_token=")
    );
    expect(cleared).toMatch(/refresh_token=;/);

    expect((await refresh(phone.cookie)).status).toBe(401);
    // The access token of that login stops working too.
    const chats = await request(app).get("/api/chat").set(bearer(phone.token));
    expect(chats.status).toBe(401);
    // Other logins are untouched.
    expect((await refresh(laptop.cookie)).status).toBe(200);
  });

  it("works without a cookie and checks the origin", async () => {
    const none = await request(app)
      .post("/api/auth/logout")
      .set("Origin", ORIGIN);
    expect(none.status).toBe(200);

    const wrong = await request(app)
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example.test")
      .set("Cookie", phone.cookie);
    expect(wrong.status).toBe(403);
    expect((await refresh(phone.cookie)).status).toBe(200);

    const missing = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", laptop.cookie);
    expect(missing.status).toBe(403);
  });
});

describe("POST /api/auth/logout-all", () => {
  it("revokes every login of the user", async () => {
    const other = await createUser();
    const otherLogin = await loginAs(other);

    const res = await request(app)
      .post("/api/auth/logout-all")
      .set(bearer(phone.token));
    expect(res.status).toBe(200);

    expect((await refresh(phone.cookie)).status).toBe(401);
    expect((await refresh(laptop.cookie)).status).toBe(401);
    expect((await refresh(user.cookie)).status).toBe(401);
    expect((await refresh(otherLogin.cookie)).status).toBe(200);
    expect(
      await Session.countDocuments({ userId: user.id, revokedAt: null })
    ).toBe(0);
  });

  it("needs a valid access token", async () => {
    expect((await request(app).post("/api/auth/logout-all")).status).toBe(401);
  });
});

describe("GET /api/auth/sessions", () => {
  it("lists active logins and marks the current one", async () => {
    const res = await request(app)
      .get("/api/auth/sessions")
      .set(bearer(phone.token));
    expect(res.status).toBe(200);
    // Registration, phone and laptop.
    expect(res.body).toHaveLength(3);

    const mine = res.body.find((s) => s.current);
    expect(mine.id).toBe(sidOf(phone));
    expect(mine.userAgent).toBe("Phone/1.0");
    expect(res.body.filter((s) => s.current)).toHaveLength(1);
    expect(res.body.find((s) => s.id === sidOf(laptop)).userAgent).toBe(
      "Laptop/2.0"
    );
    for (const s of res.body) {
      expect(Object.keys(s).sort()).toEqual([
        "createdAt",
        "current",
        "id",
        "lastUsedAt",
        "userAgent",
      ]);
    }
  });

  it("keeps one entry per login across rotations and never exposes tokens", async () => {
    const rotated = await refresh(phone.cookie);
    const res = await request(app)
      .get("/api/auth/sessions")
      .set(bearer(rotated.body.token));
    expect(res.body).toHaveLength(3);

    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/tokenHash|refresh_token|[0-9a-f]{64}/);
  });

  it("hides revoked logins and other users' logins", async () => {
    const other = await createUser();
    await loginAs(other);
    await Session.updateMany(
      { familyId: sidOf(laptop) },
      { revokedAt: new Date() }
    );

    const res = await request(app)
      .get("/api/auth/sessions")
      .set(bearer(phone.token));
    expect(res.body.map((s) => s.id)).not.toContain(sidOf(laptop));
    expect(res.body).toHaveLength(2);
  });
});

describe("DELETE /api/auth/sessions/:id", () => {
  it("revokes one login", async () => {
    const res = await request(app)
      .delete(`/api/auth/sessions/${sidOf(laptop)}`)
      .set(bearer(phone.token));
    expect(res.status).toBe(200);

    expect((await refresh(laptop.cookie)).status).toBe(401);
    expect((await refresh(phone.cookie)).status).toBe(200);
  });

  it("can revoke the current login", async () => {
    const res = await request(app)
      .delete(`/api/auth/sessions/${sidOf(phone)}`)
      .set(bearer(phone.token));
    expect(res.status).toBe(200);
    expect((await refresh(phone.cookie)).status).toBe(401);
  });

  it("returns 404 for unknown logins and for other users' logins", async () => {
    const other = await createUser();
    const otherLogin = await loginAs(other);

    const foreign = await request(app)
      .delete(`/api/auth/sessions/${sidOf(otherLogin)}`)
      .set(bearer(phone.token));
    expect(foreign.status).toBe(404);
    expect((await refresh(otherLogin.cookie)).status).toBe(200);

    const unknown = await request(app)
      .delete("/api/auth/sessions/507f1f77bcf86cd799439011")
      .set(bearer(phone.token));
    expect(unknown.status).toBe(404);

    const bad = await request(app)
      .delete("/api/auth/sessions/not-an-id")
      .set(bearer(phone.token));
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/auth/change-password", () => {
  const change = (login, body) =>
    request(app)
      .post("/api/auth/change-password")
      .set(bearer(login.token))
      .send(body);

  it("changes the password and ends the other logins", async () => {
    const res = await change(phone, {
      currentPassword: user.password,
      newPassword: "a-brand-new-passw0rd",
    });
    expect(res.status).toBe(200);

    // The login that made the change survives; the others do not.
    expect((await refresh(phone.cookie)).status).toBe(200);
    expect((await refresh(laptop.cookie)).status).toBe(401);
    expect((await refresh(user.cookie)).status).toBe(401);
    const chats = await request(app).get("/api/chat").set(bearer(laptop.token));
    expect(chats.status).toBe(401);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "a-brand-new-passw0rd" });
    expect(newLogin.status).toBe(200);
  });

  it("requires the current password", async () => {
    const res = await change(phone, {
      currentPassword: "not-my-password-1",
      newPassword: "a-brand-new-passw0rd",
    });
    expect(res.status).toBe(403);
    expect((await refresh(laptop.cookie)).status).toBe(200);
  });

  it.each([
    ["too short", "abc123"],
    ["without a digit", "only-letters-here"],
    ["without a letter", "1234567890123"],
    ["too long", "a1".repeat(40)],
  ])("applies the registration rules (%s)", async (_label, newPassword) => {
    const res = await change(phone, {
      currentPassword: user.password,
      newPassword,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^newPassword/);
  });

  it("refuses to reuse the current password and needs a token", async () => {
    const same = await change(phone, {
      currentPassword: user.password,
      newPassword: user.password,
    });
    expect(same.status).toBe(400);

    const anonymous = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: user.password,
        newPassword: "a-brand-new-passw0rd",
      });
    expect(anonymous.status).toBe(401);
  });

  it("rejects values that are not strings", async () => {
    const res = await change(phone, {
      currentPassword: { $ne: null },
      newPassword: "a-brand-new-passw0rd",
    });
    expect(res.status).toBe(400);
  });
});

describe("blocking a user", () => {
  it("revokes all of their sessions", async () => {
    const admin = await makeAdmin(await createUser());
    const res = await request(app)
      .patch(`/api/admin/block/${user.id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);

    expect(
      await Session.countDocuments({ userId: user.id, revokedAt: null })
    ).toBe(0);
    expect((await User.findById(user.id)).isBlocked).toBe(true);

    // After unblocking they still have to sign in again.
    await request(app)
      .patch(`/api/admin/unblock/${user.id}`)
      .set(bearer(admin.token));
    expect((await refresh(phone.cookie)).status).toBe(401);
    expect(
      refreshCookieFrom(await loginAs(user).then((l) => l.res))
    ).toBeDefined();
  });
});
