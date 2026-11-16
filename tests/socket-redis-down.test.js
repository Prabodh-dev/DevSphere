import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";

// Nothing listens on this port, so Redis is unreachable for the whole file.
process.env.REDIS_URL = "redis://127.0.0.1:1";

const { startSocketServer, once, sleep } = await import("./helpers/socket.js");

const newId = () => new mongoose.Types.ObjectId().toString();

let server;

beforeAll(async () => {
  server = await startSocketServer();
});

afterAll(async () => {
  await server.close();
});

describe("socket server without Redis", () => {
  it("still accepts connections and relays messages", async () => {
    const chatId = newId();
    const a = await server.client(newId());
    const b = await server.client(newId());

    a.emit("join-chat", chatId);
    b.emit("join-chat", chatId);
    await sleep(100);

    const received = once(b, "receive-message");
    a.emit("send-message", { chatId, message: { text: "no redis needed" } });
    expect(await received).toEqual({ text: "no redis needed" });
  });

  it("still delivers notifications", async () => {
    const targetId = newId();
    const sender = await server.client(newId());
    const target = await server.client(targetId);

    const received = once(target, "receive-notification");
    sender.emit("send-notification", {
      toUserId: targetId,
      notification: { type: "group" },
    });
    expect(await received).toEqual({ type: "group" });
  });
});
