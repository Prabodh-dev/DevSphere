import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Chat from "../models/Chat.js";
import { startSocketServer, once, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/users.js";

let server;
let alice;
let chat;

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  alice = await createUser();
  chat = await Chat.create({ members: [alice.id] });
  server = await startSocketServer({ rateLimit: { max: 5, windowMs: 1000 } });
});

afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});

describe("socket rate limit", () => {
  it("drops events beyond the allowance and reports it", async () => {
    const a = await server.client(alice);
    a.emit("join-chat", chat.id);
    await sleep(100);

    const limited = once(a, "socket-error");
    for (let i = 0; i < 20; i++) a.emit("typing", chat.id);

    expect(await limited).toEqual({
      event: "typing",
      message: "Rate limit exceeded",
    });
  });

  it("allows events again in the next window", async () => {
    const a = await server.client(alice);
    for (let i = 0; i < 20; i++) a.emit("typing", chat.id);
    await sleep(1200);

    const errors = [];
    a.on("socket-error", (e) => errors.push(e));
    a.emit("typing", chat.id);
    await sleep(200);
    expect(errors).toEqual([]);
  });

  it("disconnects clients that keep flooding", async () => {
    const a = await server.client(alice);
    const closed = once(a, "disconnect", 5000);
    for (let i = 0; i < 200; i++) a.emit("typing", chat.id);
    await closed;
    expect(a.connected).toBe(false);
  });
});
