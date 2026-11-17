import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Report from "../models/Report.js";
import Session from "../models/Session.js";
import Status from "../models/Status.js";
import User from "../models/User.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

let alice;
let bob;
let carol;
let admin;
let chat;
let message;
let status;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  await Report.init();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  admin = await makeAdmin(await createUser());
  chat = await Chat.create({ members: [alice.id, bob.id] });
  message = await Message.create({
    chat: chat.id,
    sender: bob.id,
    text: "rude",
  });
  status = await Status.create({
    user: bob.id,
    type: "text",
    content: "rude",
    visibleUntil: new Date(Date.now() + 3600000),
    expiresAt: new Date(Date.now() + 7200000),
  });
});

const missingId = () => new mongoose.Types.ObjectId().toString();
const report = (user, body) =>
  request(app)
    .post("/api/v1/report")
    .set(bearer(user.token))
    .send({ reason: "spam", ...body });
const admins = {
  get: (p) => request(app).get(p).set(bearer(admin.token)),
  remove: (type, id) =>
    request(app)
      .delete(`/api/v1/admin/remove/${type}/${id}`)
      .set(bearer(admin.token)),
};

describe("filing a report", () => {
  it("accepts reports for existing messages, statuses and users", async () => {
    expect(
      (await report(alice, { targetType: "message", targetId: message.id }))
        .status
    ).toBe(201);
    expect(
      (await report(alice, { targetType: "status", targetId: status.id }))
        .status
    ).toBe(201);
    const user = await report(alice, { targetType: "user", targetId: bob.id });
    expect(user.status).toBe(201);
    expect(user.body.status).toBe("open");
  });

  it("returns 404 when the target does not exist", async () => {
    for (const targetType of ["message", "status", "user"]) {
      const res = await report(alice, { targetType, targetId: missingId() });
      expect(res.status).toBe(404);
    }
    expect(await Report.countDocuments()).toBe(0);
  });

  it("does not reveal messages from chats the reporter is not in", async () => {
    const res = await report(carol, {
      targetType: "message",
      targetId: message.id,
    });
    expect(res.status).toBe(404);
  });

  it("does not let users report themselves", async () => {
    const res = await report(alice, { targetType: "user", targetId: alice.id });
    expect(res.status).toBe(400);
  });

  it("rejects a second open report for the same target from the same user", async () => {
    const body = { targetType: "message", targetId: message.id };
    expect((await report(alice, body)).status).toBe(201);
    const again = await report(alice, body);
    expect(again.status).toBe(409);
    expect(await Report.countDocuments()).toBe(1);

    // Someone else can still report it.
    expect((await report(bob, body)).status).toBe(201);
  });

  it("holds up when the same report arrives several times at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        report(alice, { targetType: "status", targetId: status.id })
      )
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await Report.countDocuments()).toBe(1);
  });

  it("allows a new report once the earlier one was resolved", async () => {
    const body = { targetType: "user", targetId: bob.id };
    await report(alice, body);
    await Report.updateMany({}, { status: "resolved" });
    expect((await report(alice, body)).status).toBe(201);
  });
});

describe("admin removal", () => {
  it("deletes a message, resolves its reports and keeps them for the record", async () => {
    await report(alice, { targetType: "message", targetId: message.id });
    await report(bob, { targetType: "message", targetId: message.id });

    const res = await admins.remove("message", message.id);
    expect(res.status).toBe(200);
    expect(await Message.findById(message.id)).toBeNull();

    const stored = await Report.find({ targetId: message.id });
    expect(stored).toHaveLength(2);
    for (const r of stored) {
      expect(r.status).toBe("resolved");
      expect(r.resolvedAt).toBeInstanceOf(Date);
      expect(r.resolvedBy.toString()).toBe(admin.id);
    }
  });

  it("deletes a status the same way", async () => {
    await report(alice, { targetType: "status", targetId: status.id });
    expect((await admins.remove("status", status.id)).status).toBe(200);
    expect(await Status.findById(status.id)).toBeNull();
    expect((await Report.findOne()).status).toBe("resolved");
  });

  it("blocks a reported user instead of deleting anything", async () => {
    await report(alice, { targetType: "user", targetId: bob.id });
    const res = await admins.remove("user", bob.id);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("user blocked");

    const saved = await User.findById(bob.id);
    expect(saved.isBlocked).toBe(true);
    expect(await Message.countDocuments({ sender: bob.id })).toBe(1);
    expect(await Status.countDocuments({ user: bob.id })).toBe(1);
    expect(
      await Session.countDocuments({ userId: bob.id, revokedAt: null })
    ).toBe(0);
    expect((await Report.findOne()).status).toBe("resolved");
  });

  it("answers 404 for unknown targets and 400 for your own account", async () => {
    for (const type of ["message", "status", "user"]) {
      expect((await admins.remove(type, missingId())).status).toBe(404);
    }
    expect((await admins.remove("user", admin.id)).status).toBe(400);
  });

  it("only resolves open reports for that target", async () => {
    const other = await Message.create({
      chat: chat.id,
      sender: bob.id,
      text: "fine",
    });
    await report(alice, { targetType: "message", targetId: other.id });
    await report(alice, { targetType: "message", targetId: message.id });
    await admins.remove("message", message.id);

    expect((await Report.findOne({ targetId: other.id })).status).toBe("open");
  });
});

describe("listing reports", () => {
  it("shows open reports by default and can filter", async () => {
    await report(alice, { targetType: "message", targetId: message.id });
    await report(alice, { targetType: "status", targetId: status.id });
    await admins.remove("message", message.id);

    const open = await admins.get("/api/v1/admin/reports");
    expect(open.body.map((r) => r.targetType)).toEqual(["status"]);

    const resolved = await admins.get("/api/v1/admin/reports?status=resolved");
    expect(resolved.body.map((r) => r.targetType)).toEqual(["message"]);

    const all = await admins.get("/api/v1/admin/reports?status=all");
    expect(all.body).toHaveLength(2);

    expect(
      (await admins.get("/api/v1/admin/reports?status=weird")).status
    ).toBe(400);
  });
});
