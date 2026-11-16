import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { startSocketServer, once } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, loginAs, bearer, ORIGIN } from "./helpers/users.js";

let server;
let user;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
});
afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearTestDb();
  user = await createUser();
});

describe("socket access tokens", () => {
  it("are refused when they do not belong to a session", async () => {
    const old = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    const { connected } = await server.tryConnect({ token: old });
    expect(connected).toBe(false);
  });

  it("are refused after the login was revoked", async () => {
    await request(app).post("/api/auth/logout-all").set(bearer(user.token));
    const { connected } = await server.tryConnect({ token: user.token });
    expect(connected).toBe(false);
  });

  it("close the socket when the token expires, and a fresh token reconnects", async () => {
    process.env.ACCESS_TOKEN_TTL = "2s";
    let login;
    try {
      login = await loginAs(user);
    } finally {
      process.env.ACCESS_TOKEN_TTL = "15m";
    }

    const socket = await server.client({ token: login.token });
    const started = Date.now();
    await once(socket, "disconnect", 6000);
    expect(Date.now() - started).toBeLessThan(4500);
    expect(socket.connected).toBe(false);

    // The client refreshes and reconnects with the new access token.
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .set("Origin", ORIGIN)
      .set("Cookie", login.cookie)
      .send();
    expect(refreshed.status).toBe(200);
    const again = await server.tryConnect({ token: refreshed.body.token });
    expect(again.connected).toBe(true);
  });

  it("do not let an expired token connect", async () => {
    const expired = jwt.sign(
      { userId: user.id, sid: jwt.decode(user.token).sid },
      process.env.JWT_SECRET,
      { expiresIn: -5 }
    );
    expect((await server.tryConnect({ token: expired })).connected).toBe(false);
  });
});

describe("ending a login", () => {
  it("closes the sockets opened with it, and only those", async () => {
    const other = await loginAs(user);
    const mine = await server.client({ token: user.token });
    const second = await server.client({ token: other.token });

    const closed = once(mine, "disconnect");
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", ORIGIN)
      .set("Cookie", user.cookie);
    expect(res.status).toBe(200);
    await closed;

    expect(mine.connected).toBe(false);
    expect(second.connected).toBe(true);
  });

  it("closes every socket on logout-all", async () => {
    const a = await server.client({ token: user.token });
    const other = await loginAs(user);
    const b = await server.client({ token: other.token });

    const closed = Promise.all([once(a, "disconnect"), once(b, "disconnect")]);
    await request(app).post("/api/auth/logout-all").set(bearer(other.token));
    await closed;
  });
});
