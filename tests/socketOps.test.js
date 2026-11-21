import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import Chat from "../models/Chat.js";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { closeRedis } from "../config/redis.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";
import { chatRoom } from "../utils/rooms.js";

let server;
let alice;
let bob;
let carol;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
  await sleep(300);
});

afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});

beforeEach(async () => {
  app.set("io", server.io);
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
});

// The Redis adapter needs Redis to carry out room commands. These tests take
// Redis away first: the commands must still reach this instance's sockets.
describe("room commands while Redis is unreachable", () => {
  it("still remove a member from a group's rooms", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
    const c = await server.client(carol);
    c.emit("join-chat", group.id);
    await sleep(150);
    await closeRedis();

    const removed = await request(app)
      .patch("/api/v1/group/remove")
      .set(bearer(alice.token))
      .send({ chatId: group.id, userId: carol.id });
    expect(removed.status).toBe(200);

    const inRoom = await server.io.local.in(chatRoom(group.id)).fetchSockets();
    expect(inRoom).toHaveLength(0);
  });

  it("still disconnect a user who gets blocked", async () => {
    const admin = await makeAdmin(await createUser());
    const b = await server.client(bob);
    const closed = once(b, "disconnect", 3000);
    await closeRedis();

    const res = await request(app)
      .patch(`/api/v1/admin/block/${bob.id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    await closed;
    expect(b.connected).toBe(false);
  });

  it("still close the sockets of a login that ended", async () => {
    const a = await server.client(alice);
    const closed = once(a, "disconnect", 3000);
    await closeRedis();

    await request(app).post("/api/v1/auth/logout-all").set(bearer(alice.token));
    await closed;
    expect(a.connected).toBe(false);
  });

  it("leave other users' sockets alone", async () => {
    const a = await server.client(alice);
    const b = await server.client(bob);
    await closeRedis();

    await request(app).post("/api/v1/auth/logout-all").set(bearer(alice.token));
    expect(await never(b, "disconnect", 500)).toBe(true);
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(true);
  });
});
