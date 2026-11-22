import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";
import { spawn } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import app from "../app.js";
import User from "../models/User.js";
import { logger } from "../utils/logger.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { controlledEnv } from "./helpers/env.js";
import { captureLogs, LEVELS } from "./helpers/logs.js";
import { createUser, bearer } from "./helpers/users.js";
import { withEnv } from "./helpers/config.js";
import { toPosix } from "./helpers/paths.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let alice;
let logs;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  logs = captureLogs();
});
afterEach(() => logs.stop());

const requestLines = () =>
  logs.lines.filter((line) => line.route !== undefined);

describe("logger output", () => {
  function runFixture(env) {
    const child = spawn(process.execPath, ["tests/fixtures/log-once.js"], {
      cwd: root,
      env: controlledEnv(env),
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    return new Promise((resolve) => child.on("exit", () => resolve(output)));
  }

  it("is silent while the tests run, unless asked", () => {
    logs.stop();
    expect(logger.level).toBe("silent");
    logs = captureLogs();
  });

  it("writes JSON lines by default at info level", async () => {
    const output = await runFixture({});
    const lines = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((l) => l.msg)).toEqual([
      "info line",
      "warn line",
      "secret line",
    ]);
    expect(lines[0]).toMatchObject({ level: "info", answer: 42 });
    expect(typeof lines[0].time).toBe("string");
  });

  it("follows LOG_LEVEL", async () => {
    const warnOnly = await runFixture({ LOG_LEVEL: "warn" });
    expect(warnOnly).toContain("warn line");
    expect(warnOnly).not.toContain("info line");

    const debug = await runFixture({ LOG_LEVEL: "debug" });
    expect(debug).toContain("debug line");

    const silent = await runFixture({ LOG_LEVEL: "silent" });
    expect(silent.trim()).toBe("");
  });

  it("is readable text only when LOG_PRETTY is true", async () => {
    const pretty = await runFixture({ LOG_PRETTY: "true" });
    expect(() => JSON.parse(pretty.split("\n")[0])).toThrow();
    expect(pretty).toContain("info line");
    expect(pretty).toMatch(/INFO/);

    const json = await runFixture({ LOG_PRETTY: "false" });
    expect(() => JSON.parse(json.split("\n")[0])).not.toThrow();
  });

  it("redacts secrets", async () => {
    const output = await runFixture({});
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("abc123");
    expect(output).toContain("[Redacted]");

    logger.info(
      {
        headers: {
          authorization: "Bearer abc",
          cookie: "refresh_token=xyz",
          "set-cookie": "a=b",
        },
        req: { headers: { authorization: "Bearer def", cookie: "c=d" } },
        res: { headers: { "set-cookie": "e=f" } },
        body: {
          password: "p1",
          newPassword: "p2",
          currentPassword: "p3",
          token: "t1",
          refreshToken: "t2",
        },
        password: "p4",
        token: "t3",
        authorization: "Bearer ghi",
        cookie: "j=k",
      },
      "everything secret"
    );
    const text = JSON.stringify(logs.lines);
    for (const secret of [
      "Bearer abc",
      "refresh_token=xyz",
      "a=b",
      "Bearer def",
      "c=d",
      "e=f",
      "p1",
      "p2",
      "p3",
      "p4",
      "t1",
      "t2",
      "t3",
      "Bearer ghi",
      "j=k",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("[Redacted]");
  });
});

describe("request logging", () => {
  it("logs method, route pattern, status, duration and request id", async () => {
    const res = await request(app)
      .post(`/api/v1/users/${alice.id}/follow`)
      .set(bearer(alice.token));
    expect(res.status).toBe(400);

    const [line] = requestLines().filter((l) => l.method === "POST");
    expect(line).toMatchObject({
      level: "info",
      method: "POST",
      route: "/api/v1/users/:id/follow",
      status: 400,
      requestId: res.headers["x-request-id"],
      errorCode: "BAD_REQUEST",
    });
    expect(typeof line.durationMs).toBe("number");
    // The real id and the token never show up.
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain(alice.id);
    expect(text).not.toContain(alice.token);
  });

  it("writes each field once per line", async () => {
    await request(app).post("/api/v1/auth/login").send({});
    const line = logs.raw.find((text) => text.includes('"route"'));
    for (const key of [
      "requestId",
      "method",
      "route",
      "status",
      "durationMs",
    ]) {
      const count = line.split(`"${key}":`).length - 1;
      expect(count, key).toBe(1);
    }
    expect(JSON.parse(line)).toMatchObject({
      route: "/api/v1/auth/login",
      status: 400,
    });
  });

  it("logs successful requests at info and unknown routes as unmatched", async () => {
    await request(app).get("/api/v1/chat").set(bearer(alice.token));
    await request(app).get("/api/v1/nothing/here");
    const lines = requestLines();
    expect(lines.find((l) => l.route === "/api/v1/chat")).toMatchObject({
      level: "info",
      status: 200,
    });
    expect(lines.find((l) => l.status === 404)).toMatchObject({
      level: "info",
      route: "unmatched",
    });
  });

  it("keeps expected client errors at info and never logs them as errors", async () => {
    await request(app).get("/api/v1/chat");
    await request(app).post("/api/v1/auth/login").send({});
    await request(app).get("/api/v1/admin/users").set(bearer(alice.token));
    const statuses = requestLines().map((l) => [l.status, l.level]);
    expect(statuses).toEqual([
      [401, "info"],
      [400, "info"],
      [403, "info"],
    ]);
    expect(logs.lines.some((l) => LEVELS[l.level] >= LEVELS.warn)).toBe(false);
  });

  it("logs unexpected errors at error level, with the error", async () => {
    const original = User.exists;
    User.exists = () => Promise.reject(new Error("database exploded"));
    let res;
    try {
      res = await request(app).post("/api/v1/auth/register").send({
        username: "someone",
        email: "someone@example.test",
        password: "a-good-passw0rd",
      });
    } finally {
      User.exists = original;
    }
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("database exploded");

    const failure = logs.lines.find((l) => l.msg === "Unexpected error");
    expect(failure).toMatchObject({
      level: "error",
      requestId: res.headers["x-request-id"],
    });
    expect(failure.err.message).toBe("database exploded");
    expect(requestLines().find((l) => l.status === 500).level).toBe("error");
  });

  it("logs an unconfigured upload as a warning", async () => {
    const { png } = await import("./helpers/files.js");
    await withEnv({ AVATAR_BUCKET: "" }, async () => {
      const res = await request(app)
        .post("/api/v1/profile")
        .set(bearer(alice.token))
        .attach("avatar", png(), {
          filename: "a.png",
          contentType: "image/png",
        });
      expect(res.status).toBe(503);
    });
    const line = requestLines().find((l) => l.status === 503);
    expect(line).toMatchObject({
      level: "warn",
      errorCode: "UPLOADS_NOT_CONFIGURED",
    });
    expect(logs.lines.some((l) => l.level === "error")).toBe(false);
  });

  it("keeps health probes out of the info logs", async () => {
    await request(app).get("/healthz");
    expect(requestLines().find((l) => l.route === "/healthz")?.level).toBe(
      "debug"
    );
  });
});

describe("no console output", () => {
  const skip = new Set(["node_modules", "tests", ".git", "coverage", "docs"]);
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      if (skip.has(name)) return [];
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return name.endsWith(".js") ? [full] : [];
    });

  it("is left in the application code", () => {
    const offenders = files(root)
      .filter((file) => /\bconsole\.\w+\(/.test(readFileSync(file, "utf8")))
      .map((file) => toPosix(path.relative(root, file)));
    expect(offenders).toEqual([]);
  });
});
