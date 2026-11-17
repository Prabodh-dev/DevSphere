import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import Chat from "../models/Chat.js";
import { startSocketServer, once, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { captureLogs } from "./helpers/logs.js";
import { createUser } from "./helpers/users.js";

let server;
let alice;
let chat;
let logs;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer({ rateLimit: { max: 3, windowMs: 1000 } });
});
afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  chat = await Chat.create({ members: [alice.id] });
  logs = captureLogs();
});
afterEach(() => logs.stop());

describe("socket logs", () => {
  it("carry the connection id and the verified user id", async () => {
    const socket = await server.client(alice);
    await sleep(100);
    const connected = logs.lines.find((l) => l.msg === "socket connected");
    expect(connected).toMatchObject({
      socketId: expect.any(String),
      userId: alice.id,
    });

    const closed = once(socket, "disconnect");
    socket.close();
    await closed;
    await sleep(100);
    const disconnected = logs.lines.find(
      (l) => l.msg === "socket disconnected"
    );
    expect(disconnected).toMatchObject({
      socketId: connected.socketId,
      userId: alice.id,
    });
  });

  it("do not include tokens", async () => {
    await server.client(alice);
    await server.tryConnect({ token: "not-a-token" });
    await sleep(100);
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain(alice.token);
    expect(text).not.toContain("not-a-token");
  });

  it("note refused connections without a user", async () => {
    await server.tryConnect({ token: "not-a-token" });
    await sleep(100);
    const refused = logs.lines.find(
      (l) => l.msg === "socket authentication failed"
    );
    expect(refused).toMatchObject({
      level: "info",
      socketId: expect.any(String),
    });
    expect(refused.userId).toBeUndefined();
  });

  it("warn when a connection is rate limited", async () => {
    const socket = await server.client(alice);
    for (let i = 0; i < 8; i++) socket.emit("typing", chat.id);
    await sleep(300);
    const limited = logs.lines.find(
      (l) => l.msg === "socket rate limit exceeded"
    );
    expect(limited).toMatchObject({
      level: "warn",
      userId: alice.id,
      event: "typing",
      socketId: expect.any(String),
    });
  });

  it("do not log bad input as errors", async () => {
    const socket = await server.client(alice);
    socket.emit("join-chat", "not-an-id");
    await sleep(200);
    expect(logs.lines.some((l) => l.level === "error")).toBe(false);
  });
});
