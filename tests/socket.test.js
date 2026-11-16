import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";
import LiveCode from "../models/LiveCode.js";

const newId = () => new mongoose.Types.ObjectId().toString();

let server;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
});

afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});

describe("socket relay", () => {
  it("relays send-message to the other members of a chat but not the sender", async () => {
    const chatId = newId();
    const a = await server.client(newId());
    const b = await server.client(newId());

    // No waiting between connecting and emitting: handlers are ready on connect.
    a.emit("join-chat", chatId);
    b.emit("join-chat", chatId);
    await sleep(100);

    const received = once(b, "receive-message");
    const echoed = never(a, "receive-message");
    a.emit("send-message", { chatId, message: { text: "hello" } });

    expect(await received).toEqual({ text: "hello" });
    expect(await echoed).toBe(true);
  });

  it("delivers group-message to everyone in the room, sender included", async () => {
    const chatId = newId();
    const a = await server.client(newId());
    const b = await server.client(newId());
    a.emit("join-chat", chatId);
    b.emit("join-chat", chatId);
    await sleep(100);

    const toA = once(a, "receive-message");
    const toB = once(b, "receive-message");
    a.emit("group-message", { chatId, message: { text: "hi all" } });

    expect(await toA).toEqual({ text: "hi all" });
    expect(await toB).toEqual({ text: "hi all" });
  });

  it("relays typing and stop-typing with the sender's id", async () => {
    const chatId = newId();
    const idA = newId();
    const a = await server.client(idA);
    const b = await server.client(newId());
    a.emit("join-chat", chatId);
    b.emit("join-chat", chatId);
    await sleep(100);

    const typing = once(b, "typing");
    a.emit("typing", chatId);
    expect(await typing).toBe(idA);

    const stopped = once(b, "stop-typing");
    a.emit("stop-typing", chatId);
    expect(await stopped).toBe(idA);
  });

  it("announces presence to other connected users", async () => {
    const a = await server.client(newId());
    const newcomer = newId();
    const online = once(a, "user-online");
    await server.client(newcomer);
    expect(await online).toBe(newcomer);
  });

  it("disconnects clients without a usable user id", async () => {
    const missing = server.anonymous();
    await once(missing, "disconnect");
    expect(missing.connected).toBe(false);

    const malformed = server.anonymous({ userId: "not-an-id" });
    await once(malformed, "disconnect");
    expect(malformed.connected).toBe(false);
  });
});

describe("notifications", () => {
  it("reaches the target user through their personal room", async () => {
    const targetId = newId();
    const sender = await server.client(newId());
    const target = await server.client(targetId);

    const received = once(target, "receive-notification");
    sender.emit("send-notification", {
      toUserId: targetId,
      notification: { type: "follow" },
    });

    expect(await received).toEqual({ type: "follow" });
  });

  it("is delivered to every open connection of that user", async () => {
    const targetId = newId();
    const sender = await server.client(newId());
    const tab1 = await server.client(targetId);
    const tab2 = await server.client(targetId);

    const both = Promise.all([
      once(tab1, "receive-notification"),
      once(tab2, "receive-notification"),
    ]);
    sender.emit("send-notification", {
      toUserId: targetId,
      notification: { type: "message" },
    });
    expect(await both).toEqual([{ type: "message" }, { type: "message" }]);
  });
});

describe("live code", () => {
  it("stores live code and sends it to a later joiner", async () => {
    const chatId = newId();
    const userId = newId();
    const a = await server.client(userId);

    a.emit("code-change", {
      chatId,
      code: "console.log(1)",
      language: "javascript",
      fileName: "main",
    });
    await sleep(500);

    const doc = await LiveCode.findOne({ chatId });
    expect(doc.code).toBe("console.log(1)");
    // The editor is the connected user, not whatever the payload claims.
    expect(doc.updatedBy.toString()).toBe(userId);

    const b = await server.client(newId());
    const loaded = once(b, "load-code");
    b.emit("join-live-code", { chatId });
    expect((await loaded).code).toBe("console.log(1)");
  });

  it("broadcasts code changes to others in the live room", async () => {
    const chatId = newId();
    const a = await server.client(newId());
    const b = await server.client(newId());
    a.emit("join-live-code", { chatId });
    b.emit("join-live-code", { chatId });
    await sleep(200);

    const update = once(b, "code-update");
    a.emit("code-change", {
      chatId,
      code: "x = 1",
      language: "python",
      fileName: "a.py",
    });
    expect(await update).toEqual({
      code: "x = 1",
      language: "python",
      fileName: "a.py",
    });
  });
});

describe("invalid input", () => {
  it("answers a malformed live-code event with an error event and keeps running", async () => {
    const a = await server.client(newId());

    const error = once(a, "socket-error");
    a.emit("code-change", { chatId: "not-an-object-id", code: "x" });
    expect(await error).toMatchObject({ event: "code-change" });

    const joinError = once(a, "socket-error");
    a.emit("join-live-code", { chatId: { $ne: null } });
    expect(await joinError).toMatchObject({ event: "join-live-code" });

    // The server is still alive and handling events.
    const chatId = newId();
    a.emit("code-change", {
      chatId,
      code: "ok",
      language: "js",
      fileName: "f",
    });
    await sleep(300);
    expect((await LiveCode.findOne({ chatId })).code).toBe("ok");
  });

  it("ignores malformed payloads for the other events", async () => {
    const a = await server.client(newId());
    const errors = [];
    a.on("socket-error", (e) => errors.push(e.event));

    a.emit("join-chat", "nope");
    a.emit("send-message", null);
    a.emit("send-message", { chatId: "nope", message: {} });
    a.emit("group-message", "text");
    a.emit("typing", 42);
    a.emit("send-notification", { toUserId: "nope", notification: {} });
    a.emit("code-change");
    await sleep(400);

    expect(errors.length).toBeGreaterThanOrEqual(6);

    // Still working afterwards.
    const chatId = newId();
    const b = await server.client(newId());
    a.emit("join-chat", chatId);
    b.emit("join-chat", chatId);
    await sleep(100);
    const received = once(b, "receive-message");
    a.emit("send-message", { chatId, message: { text: "still here" } });
    expect(await received).toEqual({ text: "still here" });
  });
});
