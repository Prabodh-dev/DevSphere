import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

let alice;
let bob;
let carol;
let withBob;
let withCarol;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  withBob = await Chat.create({ members: [alice.id, bob.id] });
  withCarol = await Chat.create({ members: [alice.id, carol.id] });
});

const send = (user, chat, body) =>
  request(app)
    .post("/api/chat/message")
    .set(bearer(user.token))
    .send({ chatId: chat.id, ...body });
const list = (user) => request(app).get("/api/chat").set(bearer(user.token));
const tick = () => new Promise((r) => setTimeout(r, 15));

describe("latest message", () => {
  it("is stored on the chat when a message is sent", async () => {
    const res = await send(alice, withBob, { text: "hello" });
    const chat = await Chat.findById(withBob.id);
    expect(chat.latestMessage.toString()).toBe(res.body._id);
  });

  it("shows a short preview in the chat list", async () => {
    await send(alice, withBob, { text: "hello there" });
    const chats = (await list(bob)).body;
    const chat = chats.find((c) => c._id === withBob.id);

    expect(Object.keys(chat.latestMessage).sort()).toEqual([
      "createdAt",
      "preview",
      "sender",
    ]);
    expect(chat.latestMessage.preview).toBe("hello there");
    expect(chat.latestMessage.sender).toEqual({
      _id: alice.id,
      username: alice.username,
    });
  });

  it("uses [code] for code messages and shortens long text", async () => {
    await send(alice, withBob, {
      type: "code",
      code: { language: "js", content: "const secret = 1;" },
    });
    let chat = (await list(alice)).body.find((c) => c._id === withBob.id);
    expect(chat.latestMessage.preview).toBe("[code]");
    expect(JSON.stringify(chat.latestMessage)).not.toContain("secret");

    await send(bob, withBob, { text: "x".repeat(300) });
    chat = (await list(alice)).body.find((c) => c._id === withBob.id);
    expect(chat.latestMessage.preview).toHaveLength(101);
    expect(chat.latestMessage.preview.endsWith("…")).toBe(true);
  });

  it("is null for a chat without messages", async () => {
    const chat = (await list(alice)).body.find((c) => c._id === withBob.id);
    expect(chat.latestMessage).toBeNull();
  });

  it("orders the chat list by recent activity", async () => {
    await send(alice, withBob, { text: "first" });
    await tick();
    await send(alice, withCarol, { text: "second" });
    expect((await list(alice)).body.map((c) => c._id)).toEqual([
      withCarol.id,
      withBob.id,
    ]);

    await tick();
    await send(bob, withBob, { text: "third" });
    expect((await list(alice)).body.map((c) => c._id)).toEqual([
      withBob.id,
      withCarol.id,
    ]);
  });

  it("moves back when the newest message is removed by an admin", async () => {
    const admin = await makeAdmin(await createUser());
    await send(alice, withBob, { text: "keep me" });
    await tick();
    const newest = await send(bob, withBob, { text: "remove me" });
    const before = (await Chat.findById(withBob.id)).updatedAt;

    const res = await request(app)
      .delete(`/api/admin/remove/message/${newest.body._id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);

    const chat = (await list(alice)).body.find((c) => c._id === withBob.id);
    expect(chat.latestMessage.preview).toBe("keep me");
    // Cleaning up does not count as chat activity.
    expect((await Chat.findById(withBob.id)).updatedAt).toEqual(before);

    const only = await Message.findOne({ chat: withBob.id });
    await request(app)
      .delete(`/api/admin/remove/message/${only.id}`)
      .set(bearer(admin.token));
    const empty = (await list(alice)).body.find((c) => c._id === withBob.id);
    expect(empty.latestMessage).toBeNull();
  });
});
