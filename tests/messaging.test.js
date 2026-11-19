import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import {
  startSocketServer,
  once,
  never,
  sleep,
  emitAck,
  collect,
} from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

let server;
let alice;
let bob;
let carol;
let chat;

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
  bob = await createUser();
  carol = await createUser();
  chat = await Chat.create({ members: [alice.id, bob.id] });
});

const sendRest = (user, body) =>
  request(app).post("/api/v1/chat/message").set(bearer(user.token)).send(body);

describe("sending over a socket", () => {
  it("saves the message, moves latestMessage and acknowledges with the stored id", async () => {
    const a = await server.client(alice);
    const reply = await emitAck(a, "send-message", {
      chatId: chat.id,
      text: "hello",
    });

    expect(reply.ok).toBe(true);
    const stored = await Message.findById(reply.id);
    expect(stored.text).toBe("hello");
    expect(stored.sender.toString()).toBe(alice.id);
    expect(new Date(reply.createdAt).getTime()).toBe(
      stored.createdAt.getTime()
    );
    expect(reply.chatId).toBe(chat.id);
    expect((await Chat.findById(chat.id)).latestMessage.toString()).toBe(
      reply.id
    );
  });

  it("is delivered by the server to members, whether or not they joined the chat", async () => {
    const a = await server.client(alice);
    const joined = await server.client(bob);
    const notJoined = await server.client(bob);
    joined.emit("join-chat", chat.id);
    await sleep(150);

    const toJoined = once(joined, "receive-message");
    const toOther = once(notJoined, "receive-message");
    const reply = await emitAck(a, "send-message", {
      chatId: chat.id,
      text: "hi bob",
    });

    for (const message of [await toJoined, await toOther]) {
      expect(message._id).toBe(reply.id);
      expect(message.text).toBe("hi bob");
      expect(message.sender).toMatchObject({
        _id: alice.id,
        username: alice.username,
      });
    }
  });

  it("reaches a socket that is in both the chat room and the user room only once", async () => {
    const b = await server.client(bob);
    b.emit("join-chat", chat.id);
    await sleep(150);

    const a = await server.client(alice);
    const heard = collect(b, "receive-message");
    await emitAck(a, "send-message", { chatId: chat.id, text: "once" });
    expect(await heard).toHaveLength(1);
  });

  it("also reaches the sender's other connections", async () => {
    const a1 = await server.client(alice);
    const a2 = await server.client(alice);
    const onOther = once(a2, "receive-message");
    await emitAck(a1, "send-message", { chatId: chat.id, text: "mine" });
    expect((await onOther).text).toBe("mine");
  });

  it("keeps working under the older group-message name", async () => {
    const b = await server.client(bob);
    const a = await server.client(alice);
    const received = once(b, "receive-message");
    const reply = await emitAck(a, "group-message", {
      chatId: chat.id,
      text: "legacy name",
    });
    expect(reply.ok).toBe(true);
    expect((await received).text).toBe("legacy name");
  });

  it("sends code messages", async () => {
    const b = await server.client(bob);
    const a = await server.client(alice);
    const received = once(b, "receive-message");
    await emitAck(a, "send-message", {
      chatId: chat.id,
      type: "code",
      code: { language: "js", content: "let x = 1" },
    });
    expect((await received).code.content).toBe("let x = 1");
  });

  it("does not let the client choose who receives it", async () => {
    const c = await server.client(carol);
    const a = await server.client(alice);
    const leaked = never(c, "receive-message");
    await emitAck(a, "send-message", {
      chatId: chat.id,
      text: "private",
      to: [carol.id],
      room: `user:${carol.id}`,
      members: [carol.id],
    });
    expect(await leaked).toBe(true);
  });

  it("answers a non-member through the acknowledgement and saves nothing", async () => {
    const c = await server.client(carol);
    const errors = [];
    c.on("socket-error", (e) => errors.push(e));

    const reply = await emitAck(c, "send-message", {
      chatId: chat.id,
      text: "let me in",
    });
    expect(reply).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Not a member of this chat" },
    });
    await sleep(150);
    expect(errors).toEqual([]);
    expect(await Message.countDocuments()).toBe(0);
  });

  it("answers invalid payloads through the acknowledgement", async () => {
    const a = await server.client(alice);
    const reply = await emitAck(a, "send-message", { chatId: chat.id });
    expect(reply.ok).toBe(false);
    expect(reply.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("sending over REST", () => {
  it("reaches connected members in real time", async () => {
    const b = await server.client(bob);
    const joined = await server.client(bob);
    joined.emit("join-chat", chat.id);
    await sleep(150);

    const toB = once(b, "receive-message");
    const toJoined = once(joined, "receive-message");
    const res = await sendRest(alice, { chatId: chat.id, text: "from rest" });

    expect(res.status).toBe(201);
    expect((await toB)._id).toBe(res.body._id);
    expect((await toJoined).text).toBe("from rest");
  });

  it("does not reach people outside the chat", async () => {
    const c = await server.client(carol);
    c.emit("join-chat", chat.id);
    await sleep(100);
    const leaked = never(c, "receive-message");
    await sendRest(alice, { chatId: chat.id, text: "members only" });
    expect(await leaked).toBe(true);
  });

  it("is refused for non-members without delivering anything", async () => {
    const b = await server.client(bob);
    const silent = never(b, "receive-message");
    const res = await sendRest(carol, { chatId: chat.id, text: "no" });
    expect(res.status).toBe(403);
    expect(await silent).toBe(true);
  });
});

describe("who receives a message", () => {
  it("skips a blocked member", async () => {
    const b = await server.client(bob);
    b.emit("join-chat", chat.id);
    await sleep(150);
    // Blocked in the database while the connection is still open.
    await User.updateOne({ _id: bob.id }, { isBlocked: true });

    const silent = never(b, "receive-message");
    const a = await server.client(alice);
    const own = once(a, "receive-message");
    await emitAck(a, "send-message", { chatId: chat.id, text: "not for bob" });
    await own;
    expect(await silent).toBe(true);
  });

  it("skips a member who was removed from the group", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
    const c = await server.client(carol);
    c.emit("join-chat", group.id);
    await sleep(150);

    const removed = await request(app)
      .patch("/api/v1/group/remove")
      .set(bearer(alice.token))
      .send({ chatId: group.id, userId: carol.id });
    expect(removed.status).toBe(200);

    const silent = never(c, "receive-message");
    await sendRest(alice, { chatId: group.id, text: "after removal" });
    expect(await silent).toBe(true);
  });
});
