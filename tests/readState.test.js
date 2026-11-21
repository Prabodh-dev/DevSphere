import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import ChatRead from "../models/ChatRead.js";
import Message from "../models/Message.js";
import {
  startSocketServer,
  once,
  never,
  sleep,
  emitAck,
} from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

let server;
let alice;
let bob;
let carol;
let chat;
let messages;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
});

afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});

// Alice sends m0, m1 and m3; Bob sends m2. Times are a second apart.
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  chat = await Chat.create({ members: [alice.id, bob.id] });

  const senders = [alice, alice, bob, alice];
  const start = Date.now() - 60 * 1000;
  messages = [];
  for (const [i, sender] of senders.entries()) {
    messages.push(
      await Message.create({
        chat: chat.id,
        sender: sender.id,
        text: `message ${i}`,
        createdAt: new Date(start + i * 1000),
      })
    );
  }
});

const markRead = (user, chatId, messageId) =>
  request(app)
    .put(`/api/v1/chat/${chatId}/read`)
    .set(bearer(user.token))
    .send({ messageId });

const list = async (user) =>
  (await request(app).get("/api/v1/chat").set(bearer(user.token))).body.items;

describe("PUT /api/v1/chat/:chatId/read", () => {
  it("moves the marker and returns what is still unread", async () => {
    // Bob has not read anything: three messages from Alice.
    expect((await list(bob))[0].unreadCount).toBe(3);

    const res = await markRead(bob, chat.id, messages[1].id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      chatId: chat.id,
      messageId: messages[1].id,
      unreadCount: 1,
      changed: true,
    });
    expect((await list(bob))[0].unreadCount).toBe(1);

    const all = await markRead(bob, chat.id, messages[3].id);
    expect(all.body).toMatchObject({ unreadCount: 0, changed: true });
  });

  it("never moves backwards", async () => {
    await markRead(bob, chat.id, messages[3].id);

    const back = await markRead(bob, chat.id, messages[0].id);
    expect(back.status).toBe(200);
    expect(back.body).toEqual({
      chatId: chat.id,
      messageId: messages[3].id,
      unreadCount: 0,
      changed: false,
    });
    const same = await markRead(bob, chat.id, messages[3].id);
    expect(same.body.changed).toBe(false);

    const marker = await ChatRead.findOne({ chat: chat.id, user: bob.id });
    expect(marker.lastReadMessage.toString()).toBe(messages[3].id);
  });

  it("ends up at the newest message when requests race", async () => {
    await Promise.all([
      markRead(bob, chat.id, messages[3].id),
      markRead(bob, chat.id, messages[0].id),
      markRead(bob, chat.id, messages[2].id),
      markRead(bob, chat.id, messages[1].id),
    ]);
    const marker = await ChatRead.findOne({ chat: chat.id, user: bob.id });
    expect(marker.lastReadMessage.toString()).toBe(messages[3].id);
    expect(await ChatRead.countDocuments()).toBe(1);
  });

  it("keeps a separate marker for each member", async () => {
    await markRead(bob, chat.id, messages[3].id);
    // Alice's own messages never count; only Bob's m2 is unread for her.
    expect((await list(alice))[0].unreadCount).toBe(1);
    await markRead(alice, chat.id, messages[2].id);
    expect((await list(alice))[0].unreadCount).toBe(0);
    expect((await list(bob))[0].unreadCount).toBe(0);
  });

  it("counts new messages after the marker, but not your own", async () => {
    await markRead(bob, chat.id, messages[3].id);
    await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({ chatId: chat.id, text: "new" });
    await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(bob.token))
      .send({ chatId: chat.id, text: "mine" });
    expect((await list(bob))[0].unreadCount).toBe(1);
  });

  it("is refused for people outside the chat, without saving anything", async () => {
    const res = await markRead(carol, chat.id, messages[0].id);
    expect(res.status).toBe(403);
    expect(await ChatRead.countDocuments()).toBe(0);
  });

  it("answers unknown chats and messages with 404", async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    expect((await markRead(bob, missing, messages[0].id)).status).toBe(404);
    expect((await markRead(bob, chat.id, missing)).status).toBe(404);

    // A message of another chat is not a message of this one.
    const other = await Chat.create({ members: [alice.id, carol.id] });
    const elsewhere = await Message.create({
      chat: other.id,
      sender: carol.id,
      text: "elsewhere",
    });
    expect((await markRead(bob, chat.id, elsewhere.id)).status).toBe(404);
  });

  it("validates ids and needs a login", async () => {
    const bad = await request(app)
      .put(`/api/v1/chat/${chat.id}/read`)
      .set(bearer(bob.token))
      .send({ messageId: "nope" });
    expect(bad.status).toBe(400);

    const anonymous = await request(app)
      .put(`/api/v1/chat/${chat.id}/read`)
      .send({ messageId: messages[0].id });
    expect(anonymous.status).toBe(401);
  });

  it("starts the chat list at zero for a chat with no messages", async () => {
    await Chat.create({ members: [bob.id, carol.id] });
    const items = await list(carol);
    expect(items).toHaveLength(1);
    expect(items[0].unreadCount).toBe(0);
  });
});

describe("mark-read over a socket", () => {
  it("acknowledges and tells the chat, once, when the marker moves", async () => {
    const a = await server.client(alice);
    const b = await server.client(bob);
    a.emit("join-chat", chat.id);
    b.emit("join-chat", chat.id);
    await sleep(150);

    const receipt = once(a, "read-receipt");
    const reply = await emitAck(b, "mark-read", {
      chatId: chat.id,
      messageId: messages[1].id,
    });
    expect(reply).toEqual({
      ok: true,
      chatId: chat.id,
      messageId: messages[1].id,
      unreadCount: 1,
      changed: true,
    });

    const got = await receipt;
    expect(got).toMatchObject({
      chatId: chat.id,
      userId: bob.id,
      messageId: messages[1].id,
    });
    expect(new Date(got.readAt).getTime()).toBeGreaterThan(0);

    // Going back, or repeating, is not announced.
    const quiet = never(a, "read-receipt");
    const back = await emitAck(b, "mark-read", {
      chatId: chat.id,
      messageId: messages[0].id,
    });
    expect(back).toMatchObject({ ok: true, changed: false });
    expect(await quiet).toBe(true);
  });

  it("also sends the receipt for a REST change", async () => {
    const a = await server.client(alice);
    a.emit("join-chat", chat.id);
    await sleep(150);
    const receipt = once(a, "read-receipt");
    await markRead(bob, chat.id, messages[2].id);
    expect(await receipt).toMatchObject({ userId: bob.id });
  });

  it("is refused for non-members and sends no receipt", async () => {
    const a = await server.client(alice);
    a.emit("join-chat", chat.id);
    await sleep(150);

    const c = await server.client(carol);
    const quiet = never(a, "read-receipt");
    const reply = await emitAck(c, "mark-read", {
      chatId: chat.id,
      messageId: messages[0].id,
    });
    expect(reply).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Not a member of this chat" },
    });
    expect(await quiet).toBe(true);
    expect(await ChatRead.countDocuments()).toBe(0);
  });

  it("rejects malformed payloads", async () => {
    const b = await server.client(bob);
    const reply = await emitAck(b, "mark-read", { chatId: chat.id });
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe("VALIDATION_ERROR");
  });
});
