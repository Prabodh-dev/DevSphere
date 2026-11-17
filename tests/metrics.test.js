import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Session from "../models/Session.js";
import { startSocketServer, once, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { withEnv } from "./helpers/config.js";
import { labelSets, metricValue } from "./helpers/metrics.js";
import { expectError } from "./helpers/errors.js";
import {
  createUser,
  loginAs,
  bearer,
  refreshCookieFrom,
  tokenFromCookie,
  ORIGIN,
} from "./helpers/users.js";

let alice;
let server;

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
  alice = await createUser();
});

const on = (fn) => withEnv({ METRICS_ENABLED: "true", METRICS_TOKEN: "" }, fn);
const scrape = async (headers = {}) =>
  request(app).get("/metrics").set(headers);

describe("GET /metrics", () => {
  it("is not served unless enabled", async () => {
    const res = await scrape();
    expectError(res, 404, "NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain("process_cpu");

    await withEnv(
      { METRICS_ENABLED: "false", METRICS_TOKEN: "t" },
      async () => {
        expectError(
          await scrape({ Authorization: "Bearer t" }),
          404,
          "NOT_FOUND"
        );
      }
    );
  });

  it("serves Prometheus text with the default process metrics", async () => {
    await on(async () => {
      const res = await scrape();
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/plain/);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).toContain("# HELP process_cpu_user_seconds_total");
      expect(res.text).toContain("nodejs_eventloop_lag_seconds");
      expect(res.text).toContain(
        "# TYPE http_request_duration_seconds histogram"
      );
      expect(res.text).toContain("# TYPE socket_connections gauge");
      expect(res.text).toContain("# TYPE socket_events_total counter");
      expect(res.text).toContain("# TYPE auth_refresh_total counter");
    });
  });

  it("needs the bearer token when METRICS_TOKEN is set", async () => {
    await withEnv(
      { METRICS_ENABLED: "true", METRICS_TOKEN: "scrape-secret-1" },
      async () => {
        const missing = await scrape();
        expectError(missing, 401, "UNAUTHENTICATED");
        expect(missing.headers["www-authenticate"]).toMatch(/^Bearer/);

        for (const headers of [
          { Authorization: "Bearer wrong" },
          { Authorization: "Bearer scrape-secret-1x" },
          { Authorization: "Bearer scrape-secret-" },
          { Authorization: "Basic c2NyYXBlLXNlY3JldC0x" },
          { Authorization: "scrape-secret-1" },
          { "X-Metrics-Token": "scrape-secret-1" },
        ]) {
          expect((await scrape(headers)).status, JSON.stringify(headers)).toBe(
            401
          );
        }
        expect(
          (await request(app).get("/metrics?token=scrape-secret-1")).status
        ).toBe(401);

        const ok = await scrape({ Authorization: "Bearer scrape-secret-1" });
        expect(ok.status).toBe(200);
        expect(ok.text).toContain("process_cpu_user_seconds_total");
      }
    );
  });

  it("does not reveal whether a token is close to right", async () => {
    await withEnv(
      { METRICS_ENABLED: "true", METRICS_TOKEN: "scrape-secret-1" },
      async () => {
        const a = await scrape({ Authorization: "Bearer scrape-secret-0" });
        const b = await scrape({ Authorization: "Bearer zzz" });
        expect(a.body.error.message).toBe(b.body.error.message);
      }
    );
  });
});

describe("request metrics", () => {
  it("count requests by method, route pattern and status class", async () => {
    await on(async () => {
      const before = (await scrape()).text;
      const count = (text, route, status_class, method) =>
        metricValue(text, "http_request_duration_seconds_count", {
          method,
          route,
          status_class,
        });

      await request(app)
        .get(`/api/v1/users/${alice.id}/followers`)
        .set(bearer(alice.token));
      await request(app)
        .get(`/api/v1/users/${alice.id}/followers`)
        .set(bearer(alice.token));
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.test", password: "x-password-1" });
      await request(app).get("/api/v1/does/not/exist/for-sure");

      const after = (await scrape()).text;
      const route = "/api/v1/users/:id/followers";
      expect(
        count(after, route, "2xx", "GET") - count(before, route, "2xx", "GET")
      ).toBe(2);
      expect(
        count(after, "/api/v1/auth/login", "4xx", "POST") -
          count(before, "/api/v1/auth/login", "4xx", "POST")
      ).toBe(1);
      expect(
        count(after, "unmatched", "4xx", "GET") -
          count(before, "unmatched", "4xx", "GET")
      ).toBe(1);
      expect(after).toContain("http_request_duration_seconds_bucket{");
      expect(
        metricValue(after, "http_request_duration_seconds_sum", { route })
      ).toBeGreaterThan(0);
    });
  });

  it("only use the documented labels and never contain personal data", async () => {
    await on(async () => {
      const user = await createUser();
      const login = await loginAs(user);
      await request(app).get(`/api/v1/profile/${user.id}`);
      await request(app)
        .get(`/api/v1/users/${user.id}/followers`)
        .set(bearer(login.token));
      await request(app)
        .post("/api/v1/auth/refresh")
        .set("Origin", ORIGIN)
        .set("Cookie", login.cookie);
      const socket = await server.client({ token: login.token });
      socket.emit("join-chat", "507f1f77bcf86cd799439011");
      await sleep(200);

      const text = (await scrape()).text;
      for (const secret of [
        user.id,
        user.email,
        user.username,
        user.token,
        login.token,
        login.cookie,
        tokenFromCookie(login.cookie),
        "Bearer",
        "127.0.0.1",
      ]) {
        expect(text, secret).not.toContain(secret);
      }

      const allowed = {
        http_request_duration_seconds_bucket: [
          "method",
          "route",
          "status_class",
          "le",
        ],
        http_request_duration_seconds_count: [
          "method",
          "route",
          "status_class",
        ],
        http_request_duration_seconds_sum: ["method", "route", "status_class"],
        socket_events_total: ["event"],
        auth_refresh_total: ["outcome"],
      };
      for (const [name, labels] of Object.entries(allowed)) {
        for (const set of labelSets(text, name)) {
          expect(Object.keys(set).sort(), name).toEqual([...labels].sort());
        }
      }
      for (const set of labelSets(
        text,
        "http_request_duration_seconds_count"
      )) {
        expect(set.route).toMatch(/^(unmatched|\/[\w/:.{}-]*)$/);
        expect(set.route).not.toMatch(/[0-9a-f]{24}/);
        expect(set.status_class).toMatch(/^[1-5]xx$/);
      }
      socket.close();
    });
  });
});

describe("socket metrics", () => {
  it("track open connections", async () => {
    await on(async () => {
      const base = metricValue((await scrape()).text, "socket_connections");
      const a = await server.client(alice);
      const b = await server.client(alice);
      await sleep(100);
      expect(metricValue((await scrape()).text, "socket_connections")).toBe(
        base + 2
      );

      const closed = once(a, "disconnect");
      a.close();
      await closed;
      await sleep(100);
      expect(metricValue((await scrape()).text, "socket_connections")).toBe(
        base + 1
      );
      b.close();
      await sleep(100);
      expect(metricValue((await scrape()).text, "socket_connections")).toBe(
        base
      );
    });
  });

  it("count the events of each name, and only known events", async () => {
    await on(async () => {
      const chat = await Chat.create({ members: [alice.id] });
      const before = (await scrape()).text;
      const socket = await server.client(alice);

      socket.emit("join-chat", chat.id);
      socket.emit("join-chat", chat.id);
      socket.emit("typing", chat.id);
      socket.emit(`made-up-${Date.now()}`, "x");
      await sleep(300);

      const after = (await scrape()).text;
      const delta = (event) =>
        metricValue(after, "socket_events_total", { event }) -
        metricValue(before, "socket_events_total", { event });
      expect(delta("join-chat")).toBe(2);
      expect(delta("typing")).toBe(1);
      expect(after).not.toContain("made-up");
      socket.close();
    });
  });
});

describe("refresh metrics", () => {
  const refresh = (cookie) => {
    let req = request(app).post("/api/v1/auth/refresh").set("Origin", ORIGIN);
    if (cookie) req = req.set("Cookie", cookie);
    return req;
  };
  const outcome = (text, name) =>
    metricValue(text, "auth_refresh_total", { outcome: name });

  it("count rotated, rejected and reuse_detected", async () => {
    await on(async () => {
      const before = (await scrape()).text;
      const login = await loginAs(alice);

      // A normal refresh.
      const first = await refresh(login.cookie);
      expect(first.status).toBe(200);
      // Unknown, missing and replayed (inside the grace window) tokens.
      expect((await refresh("refresh_token=not-real")).status).toBe(401);
      expect((await refresh()).status).toBe(401);
      expect((await refresh(login.cookie)).status).toBe(401);
      // A token replayed after the grace window ends the login.
      await Session.updateMany(
        { userId: alice.id, replacedBy: mongoose.trusted({ $ne: null }) },
        { revokedAt: new Date(Date.now() - 60000) }
      );
      expect((await refresh(login.cookie)).status).toBe(401);
      expect((await refresh(refreshCookieFrom(first))).status).toBe(401);

      const after = (await scrape()).text;
      expect(outcome(after, "rotated") - outcome(before, "rotated")).toBe(1);
      expect(
        outcome(after, "reuse_detected") - outcome(before, "reuse_detected")
      ).toBe(1);
      expect(outcome(after, "rejected") - outcome(before, "rejected")).toBe(4);
    });
  });
});
