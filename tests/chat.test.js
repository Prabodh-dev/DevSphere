import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import LiveCode from "../models/LiveCode.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

const missingId = () => new mongoose.Types.ObjectId().toString();

let alice;
let bob;
let carol;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
});

describe("POST /api/chat/access", () => {
  const access = (user, body) =>
    request(app).post("/api/chat/access").set(bearer(user.token)).send(body);

  it("creates a one-to-one chat and returns the same one next time", async () => {
    const first = await access(alice, { userId: bob.id });
    expect(first.status).toBe(200);
    expect(first.body.isGroupChat).toBe(false);
    expect(first.body.members).toHaveLength(2);

    const second = await access(alice, { userId: bob.id });
    expect(second.body._id).toBe(first.body._id);
    expect(await Chat.countDocuments()).toBe(1);
  });

  it("is found from either side", async () => {
    const fromAlice = await access(alice, { userId: bob.id });
    const fromBob = await access(bob, { userId: alice.id });
    expect(fromBob.body._id).toBe(fromAlice.body._id);
  });

  it("never returns a group chat that happens to contain both users", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });

    const res = await access(alice, { userId: bob.id });
    expect(res.status).toBe(200);
    expect(res.body._id).not.toBe(group._id.toString());
    expect(res.body.isGroupChat).toBe(false);
    expect(res.body.members).toHaveLength(2);
  });

  it("rejects the caller's own id", async () => {
    const res = await access(alice, { userId: alice.id });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the other user does not exist", async () => {
    const res = await access(alice, { userId: missingId() });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a missing or malformed user id", async () => {
    expect((await access(alice, {})).status).toBe(400);
    expect((await access(alice, { userId: "nope" })).status).toBe(400);
    expect((await access(alice, { userId: { $ne: null } })).status).toBe(400);
  });
});

describe("messages", () => {
  let chat;

  beforeEach(async () => {
    chat = await Chat.create({ members: [alice.id, bob.id] });
  });

  const send = (user, body) =>
    request(app).post("/api/chat/message").set(bearer(user.token)).send(body);
  const list = (user, chatId) =>
    request(app).get(`/api/chat/message/${chatId}`).set(bearer(user.token));

  it("lets a member send and read messages", async () => {
    const sent = await send(alice, { chatId: chat.id, text: "hello" });
    expect(sent.status).toBe(201);
    expect(sent.body.text).toBe("hello");
    expect(sent.body.sender.username).toBe(alice.username);

    const res = await list(bob, chat.id);
    expect(res.status).toBe(200);
    expect(res.body.map((m) => m.text)).toEqual(["hello"]);
  });

  it("stores code messages", async () => {
    const sent = await send(alice, {
      chatId: chat.id,
      type: "code",
      code: { language: "js", content: "let a = 1;" },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.code).toMatchObject({
      language: "js",
      content: "let a = 1;",
    });
  });

  it("refuses non-members for sending and reading", async () => {
    const sent = await send(carol, { chatId: chat.id, text: "let me in" });
    expect(sent.status).toBe(403);

    const read = await list(carol, chat.id);
    expect(read.status).toBe(403);
  });

  it("returns 404 for a chat that does not exist", async () => {
    expect((await send(alice, { chatId: missingId(), text: "x" })).status).toBe(
      404
    );
    expect((await list(alice, missingId())).status).toBe(404);
  });

  it("returns 400 for invalid ids and bodies", async () => {
    expect((await send(alice, { chatId: "bad", text: "x" })).status).toBe(400);
    expect((await list(alice, "bad")).status).toBe(400);
    expect((await send(alice, { chatId: chat.id })).status).toBe(400);
    expect(
      (await send(alice, { chatId: chat.id, text: "x", type: "weird" })).status
    ).toBe(400);
    expect(
      (await send(alice, { chatId: chat.id, type: "code", code: {} })).status
    ).toBe(400);
  });
});

describe("GET /api/live-code/:chatId", () => {
  let chat;

  beforeEach(async () => {
    chat = await Chat.create({ members: [alice.id, bob.id] });
  });

  const get = (user, chatId) =>
    request(app).get(`/api/live-code/${chatId}`).set(bearer(user.token));

  it("returns the document to a member", async () => {
    await LiveCode.create({ chatId: chat.id, code: "print(1)" });
    const res = await get(alice, chat.id);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe("print(1)");
  });

  it("returns 403 to a non-member", async () => {
    await LiveCode.create({ chatId: chat.id, code: "print(1)" });
    const res = await get(carol, chat.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
  });

  it("returns 404 for a missing chat and 400 for a bad id", async () => {
    expect((await get(alice, missingId())).status).toBe(404);
    expect((await get(alice, "bad")).status).toBe(400);
  });
});
