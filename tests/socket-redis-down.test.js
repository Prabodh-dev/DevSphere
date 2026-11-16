import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Chat from "../models/Chat.js";

// Nothing listens on this port, so Redis is unreachable for the whole file.
process.env.REDIS_URL = "redis://127.0.0.1:1";

const { startSocketServer, once, sleep } = await import("./helpers/socket.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser } = await import("./helpers/users.js");

let server;
let alice;
let bob;
let chat;

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  chat = await Chat.create({ members: [alice.id, bob.id] });
  server = await startSocketServer();
});

afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});

describe("socket server without Redis", () => {
  it("still accepts connections and relays messages", async () => {
    const a = await server.client(alice);
    const b = await server.client(bob);

    a.emit("join-chat", chat.id);
    b.emit("join-chat", chat.id);
    await sleep(150);

    const received = once(b, "receive-message");
    a.emit("send-message", {
      chatId: chat.id,
      message: { text: "no redis needed" },
    });
    expect(await received).toEqual({ text: "no redis needed" });
  });
});
