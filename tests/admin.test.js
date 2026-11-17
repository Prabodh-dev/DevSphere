import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import app from "../app.js";
import { controlledEnv } from "./helpers/env.js";
import User from "../models/User.js";
import Status from "../models/Status.js";
import Message from "../models/Message.js";
import Report from "../models/Report.js";
import {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
  testMongoUri,
} from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const missingId = () => new mongoose.Types.ObjectId().toString();

let admin;
let member;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  admin = await makeAdmin(await createUser());
  member = await createUser();
});

const as = (user) => ({
  get: (p) => request(app).get(p).set(bearer(user.token)),
  patch: (p) => request(app).patch(p).set(bearer(user.token)),
  delete: (p) => request(app).delete(p).set(bearer(user.token)),
});

describe("roles", () => {
  it("new accounts are regular users, whatever the request says", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "sneaky",
      email: "sneaky@example.test",
      password: "password-for-tests-1",
      role: "admin",
    });
    expect(res.status).toBe(201);
    const saved = await User.findById(res.body._id);
    expect(saved.role).toBe("user");
  });
});

describe("admin routes", () => {
  const routes = [
    ["get", "/api/v1/admin/users"],
    ["patch", () => `/api/v1/admin/block/${member.id}`],
    ["patch", () => `/api/v1/admin/unblock/${member.id}`],
    ["get", "/api/v1/admin/reports"],
    ["delete", () => `/api/v1/admin/remove/message/${missingId()}`],
  ];

  it.each(routes)("%s %s rejects regular users with 403", async (method, p) => {
    const url = typeof p === "function" ? p() : p;
    const res = await as(member)[method](url);
    expect(res.status).toBe(403);
  });

  it.each(routes)("%s %s still requires a token", async (method, p) => {
    const url = typeof p === "function" ? p() : p;
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });

  it("lets an admin list users, block and unblock", async () => {
    const list = await as(admin).get("/api/v1/admin/users");
    expect(list.status).toBe(200);
    expect(list.body.items.every((u) => u.password === undefined)).toBe(true);

    const block = await as(admin).patch(`/api/v1/admin/block/${member.id}`);
    expect(block.status).toBe(200);
    expect((await User.findById(member.id)).isBlocked).toBe(true);

    const unblock = await as(admin).patch(`/api/v1/admin/unblock/${member.id}`);
    expect(unblock.status).toBe(200);
    expect((await User.findById(member.id)).isBlocked).toBe(false);
  });

  it("does not let an admin block their own account", async () => {
    const res = await as(admin).patch(`/api/v1/admin/block/${admin.id}`);
    expect(res.status).toBe(400);
  });

  it("lists reports for admins", async () => {
    await Report.create({
      reportedBy: member.id,
      targetType: "message",
      targetId: missingId(),
      reason: "spam",
    });
    const res = await as(admin).get("/api/v1/admin/reports");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("admin removal of reported content", () => {
  it("validates the type and the id", async () => {
    const msg = await Message.create({
      chat: missingId(),
      sender: member.id,
      text: "x",
    });
    expect(
      (await as(admin).delete(`/api/v1/admin/remove/other/${msg.id}`)).status
    ).toBe(400);
    expect(
      (await as(admin).delete("/api/v1/admin/remove/message/nope")).status
    ).toBe(400);
    expect(
      (await as(admin).delete(`/api/v1/admin/remove/message/${missingId()}`))
        .status
    ).toBe(404);
  });

  it("deletes the item and the reports that point at it", async () => {
    const msg = await Message.create({
      chat: missingId(),
      sender: member.id,
      text: "x",
    });
    const other = await Message.create({
      chat: missingId(),
      sender: member.id,
      text: "y",
    });
    await Report.create([
      {
        reportedBy: member.id,
        targetType: "message",
        targetId: msg.id,
        reason: "spam",
      },
      {
        reportedBy: admin.id,
        targetType: "message",
        targetId: msg.id,
        reason: "abuse",
      },
      {
        reportedBy: member.id,
        targetType: "message",
        targetId: other.id,
        reason: "unrelated",
      },
    ]);

    const res = await as(admin).delete(
      `/api/v1/admin/remove/message/${msg.id}`
    );
    expect(res.status).toBe(200);
    expect(await Message.findById(msg.id)).toBeNull();
    // The reports stay for the record, marked as resolved.
    expect(
      await Report.countDocuments({ targetId: msg.id, status: "resolved" })
    ).toBe(2);
    expect(
      await Report.countDocuments({ targetId: other.id, status: "open" })
    ).toBe(1);
  });

  it("removes a status and its report", async () => {
    const status = await Status.create({
      user: member.id,
      type: "text",
      content: "hello",
      expiresAt: new Date(Date.now() + 60000),
    });
    await Report.create({
      reportedBy: admin.id,
      targetType: "status",
      targetId: status.id,
      reason: "spam",
    });
    const res = await as(admin).delete(
      `/api/v1/admin/remove/status/${status.id}`
    );
    expect(res.status).toBe(200);
    expect(await Status.findById(status.id)).toBeNull();
    expect(await Report.countDocuments({ status: "resolved" })).toBe(1);
  });
});

describe("make-admin script", () => {
  function run(args) {
    const uri = new URL(testMongoUri());
    const child = spawn(process.execPath, ["scripts/make-admin.js", ...args], {
      cwd: root,
      env: controlledEnv({ MONGO_URI: uri.toString() }),
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    return new Promise((resolve) =>
      child.on("exit", (code) => resolve({ code, output }))
    );
  }

  it("promotes an existing user by email", async () => {
    const { code } = await run([member.email.toUpperCase()]);
    expect(code).toBe(0);
    expect((await User.findById(member.id)).role).toBe("admin");
  });

  it("fails for an unknown email or without an argument", async () => {
    const unknown = await run(["nobody@example.test"]);
    expect(unknown.code).not.toBe(0);
    expect(unknown.output).toMatch(/not found/i);

    const none = await run([]);
    expect(none.code).not.toBe(0);
    expect(none.output).toMatch(/usage/i);
    expect((await User.findById(member.id)).role).toBe("user");
  });
});
