import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import Chat from "../models/Chat.js";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { withEnv } from "./helpers/config.js";
import { createUser, bearer } from "./helpers/users.js";
import { userRoom } from "../utils/rooms.js";

let first;
let second;
let alice;
let bob;
let carol;
let chat;

// The adapter subscribes in the background.
async function adapterReady(server) {
  const { subClient } = server.io.of("/").adapter;
  const deadline = Date.now() + 5000;
  while (!subClient.isReady && Date.now() < deadline) await sleep(25);
  await sleep(200);
}

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  chat = await Chat.create({ members: [alice.id, bob.id] });

  // Two instances of the app sharing one Redis.
  first = await startSocketServer();
  second = await startSocketServer();
  await Promise.all([adapterReady(first), adapterReady(second)]);
});

afterAll(async () => {
  await first.close();
  await second.close();
  await disconnectTestDb();
});

describe("several app instances", () => {
  it("use the Redis adapter when REDIS_URL is set", () => {
    expect(first.io.of("/").adapter.constructor.name).toBe("RedisAdapter");
  });

  it("deliver a socket message to a client connected to the other instance", async () => {
    const onFirst = await first.client(alice);
    const onSecond = await second.client(bob);

    const received = once(onSecond, "receive-message");
    onFirst.emit("send-message", { chatId: chat.id, text: "across" });
    expect((await received).text).toBe("across");
  });

  it("deliver a REST message to clients on both instances", async () => {
    const onFirst = await first.client(alice);
    const onSecond = await second.client(bob);

    const toFirst = once(onFirst, "receive-message");
    const toSecond = once(onSecond, "receive-message");
    const res = await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({ chatId: chat.id, text: "from rest" });

    expect(res.status).toBe(201);
    expect((await toFirst)._id).toBe(res.body._id);
    expect((await toSecond)._id).toBe(res.body._id);
  });

  it("share rooms, so one instance can see the other's sockets", async () => {
    await second.client(bob);
    const sockets = await first.io.in(userRoom(bob.id)).fetchSockets();
    expect(sockets.length).toBeGreaterThan(0);
    expect(sockets.some((s) => s.data.userId === bob.id)).toBe(true);
  });

  it("still keep messages away from people outside the chat", async () => {
    const outsider = await second.client(carol);
    const onFirst = await first.client(alice);
    const leaked = never(outsider, "receive-message");
    onFirst.emit("send-message", { chatId: chat.id, text: "members only" });
    expect(await leaked).toBe(true);
  });

  it("leave /readyz reporting Redis as a field only", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["db", "redis", "status"]);
  });
});

describe("a single instance", () => {
  it("keeps the default adapter without a Redis URL", async () => {
    await withEnv({ REDIS_URL: "" }, async () => {
      const alone = await startSocketServer();
      try {
        expect(alone.io.of("/").adapter.constructor.name).not.toBe(
          "RedisAdapter"
        );
        const a = await alone.client(alice);
        const b = await alone.client(bob);
        const received = once(b, "receive-message");
        a.emit("send-message", { chatId: chat.id, text: "alone" });
        expect((await received).text).toBe("alone");
      } finally {
        await alone.close();
      }
    });
  });
});
