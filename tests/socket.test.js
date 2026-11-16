import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";
import LiveCode from "../models/LiveCode.js";

let server;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
});

afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});

// The server currently registers its handlers after awaiting Redis, so give
// each connection a moment before emitting.
const settle = () => sleep(300);

describe("socket relay (current behaviour)", () => {
  it("relays send-message to the other members of a chat but not the sender", async () => {
    const a = server.client("user-a");
    const b = server.client("user-b");
    await settle();

    a.emit("join-chat", "room-1");
    b.emit("join-chat", "room-1");
    await settle();

    const received = once(b, "receive-message");
    const echoed = never(a, "receive-message");
    a.emit("send-message", { chatId: "room-1", message: { text: "hello" } });

    expect(await received).toEqual({ text: "hello" });
    expect(await echoed).toBe(true);
  });

  it("delivers group-message to everyone in the room, sender included", async () => {
    const a = server.client("user-a");
    const b = server.client("user-b");
    await settle();
    a.emit("join-chat", "room-2");
    b.emit("join-chat", "room-2");
    await settle();

    const toA = once(a, "receive-message");
    const toB = once(b, "receive-message");
    a.emit("group-message", { chatId: "room-2", message: { text: "hi all" } });

    expect(await toA).toEqual({ text: "hi all" });
    expect(await toB).toEqual({ text: "hi all" });
  });

  it("relays typing and stop-typing with the sender's id", async () => {
    const a = server.client("user-a");
    const b = server.client("user-b");
    await settle();
    a.emit("join-chat", "room-3");
    b.emit("join-chat", "room-3");
    await settle();

    const typing = once(b, "typing");
    a.emit("typing", "room-3");
    expect(await typing).toBe("user-a");

    const stopped = once(b, "stop-typing");
    a.emit("stop-typing", "room-3");
    expect(await stopped).toBe("user-a");
  });

  it("announces presence to other connected users", async () => {
    const a = server.client("user-a");
    await settle();
    const online = once(a, "user-online");
    server.client("user-c");
    expect(await online).toBe("user-c");
  });

  it("disconnects clients that connect without a user id", async () => {
    const anon = server.client();
    await once(anon, "disconnect");
    expect(anon.connected).toBe(false);
  });

  it("stores live code and sends it to a later joiner", async () => {
    const chatId = new mongoose.Types.ObjectId().toString();
    const a = server.client("user-a");
    await settle();

    a.emit("code-change", {
      chatId,
      code: "console.log(1)",
      language: "javascript",
      fileName: "main",
      userId: new mongoose.Types.ObjectId().toString(),
    });
    await sleep(500);

    const doc = await LiveCode.findOne({ chatId });
    expect(doc.code).toBe("console.log(1)");

    const b = server.client("user-b");
    await settle();
    const loaded = once(b, "load-code");
    b.emit("join-live-code", { chatId });
    expect((await loaded).code).toBe("console.log(1)");
  });
});
