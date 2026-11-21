import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Follow from "../models/Follow.js";
import User from "../models/User.js";
import { startSocketServer, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

let server;
let alice;
let bob;
let carol;
let dave;

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
  dave = await createUser();
});

const presence = (user, ids) =>
  request(app)
    .get("/api/v1/presence")
    .query({ ids: Array.isArray(ids) ? ids.join(",") : ids })
    .set(bearer(user.token));

async function waitForOnline(user, who, expected) {
  const deadline = Date.now() + 3000;
  let body;
  while (Date.now() < deadline) {
    body = (await presence(user, who.id)).body;
    if (body.items[0]?.online === expected) return body;
    await sleep(50);
  }
  return body;
}

describe("GET /api/v1/presence", () => {
  it("needs a login", async () => {
    const res = await request(app).get("/api/v1/presence").query({
      ids: alice.id,
    });
    expect(res.status).toBe(401);
  });

  it("rejects missing, malformed and too many ids", async () => {
    expect((await presence(alice, [])).status).toBe(400);
    expect((await presence(alice, "nope")).status).toBe(400);
    expect((await presence(alice, [bob.id, "x"])).status).toBe(400);

    const many = Array.from({ length: 101 }, () =>
      new mongoose.Types.ObjectId().toString()
    );
    expect((await presence(alice, many)).status).toBe(400);
    const max = await presence(alice, many.slice(0, 100));
    expect(max.status).toBe(200);
    expect(max.body).toEqual({ items: [] });
  });

  it("reports online, then offline with the time the last connection closed", async () => {
    await Chat.create({ members: [alice.id, bob.id] });

    let res = await presence(alice, bob.id);
    expect(res.body).toEqual({
      items: [{ userId: bob.id, online: false, lastSeen: null }],
    });

    const socket = await server.client(bob);
    res = await waitForOnline(alice, bob, true);
    expect(res.items).toEqual([
      { userId: bob.id, online: true, lastSeen: null },
    ]);

    const before = Date.now();
    socket.close();
    await waitForOnline(alice, bob, false);
    await sleep(200);
    const { items } = (await presence(alice, bob.id)).body;
    expect(items[0].online).toBe(false);
    expect(new Date(items[0].lastSeen).getTime()).toBeGreaterThanOrEqual(
      before - 50
    );
  });

  it("stays online while any of several connections is open", async () => {
    await Chat.create({ members: [alice.id, bob.id] });
    const one = await server.client(bob);
    const two = await server.client(bob);
    await waitForOnline(alice, bob, true);

    one.close();
    await sleep(300);
    expect((await presence(alice, bob.id)).body.items[0].online).toBe(true);
    two.close();
    expect((await waitForOnline(alice, bob, false)).items[0].online).toBe(
      false
    );
  });

  it("covers people you share a chat with, follow, and yourself", async () => {
    await Chat.create({ members: [alice.id, bob.id] });
    await Chat.create({
      isGroupChat: true,
      members: [alice.id, carol.id, dave.id],
      admins: [alice.id],
    });
    await Follow.create({ follower: alice.id, following: dave.id });
    const erin = await createUser();
    await Follow.create({ follower: alice.id, following: erin.id });

    const res = await presence(alice, [
      alice.id,
      bob.id,
      carol.id,
      dave.id,
      erin.id,
    ]);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.userId)).toEqual([
      alice.id,
      bob.id,
      carol.id,
      dave.id,
      erin.id,
    ]);
  });

  it("never reveals anyone else, online or not, existing or not", async () => {
    await Chat.create({ members: [alice.id, bob.id] });
    // Carol is a stranger to Alice; Dave only follows Alice (the wrong way).
    await Follow.create({ follower: dave.id, following: alice.id });
    await server.client(carol);
    await server.client(dave);
    await sleep(300);

    const missing = new mongoose.Types.ObjectId().toString();
    const res = await presence(alice, [carol.id, dave.id, missing, bob.id]);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { userId: bob.id, online: false, lastSeen: null },
    ]);
    // An unknown id and a hidden user give the same answer.
    expect((await presence(alice, [carol.id])).body).toEqual(
      (await presence(alice, [missing])).body
    );
  });

  it("does not use someone else's chats", async () => {
    // Bob and Carol know each other, Alice knows neither.
    await Chat.create({ members: [bob.id, carol.id] });
    const res = await presence(alice, [bob.id, carol.id]);
    expect(res.body.items).toEqual([]);
  });

  it("repeats nothing when an id is listed twice, and sends no private fields", async () => {
    await Chat.create({ members: [alice.id, bob.id] });
    const res = await presence(alice, [bob.id, bob.id]);
    expect(res.body.items).toHaveLength(1);
    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      "lastSeen",
      "online",
      "userId",
    ]);
  });

  it("leaves lastSeen out of the account's other responses", async () => {
    await User.updateOne({ _id: bob.id }, { lastSeenAt: new Date() });
    const res = await request(app)
      .get("/api/v1/profile/me")
      .set(bearer(bob.token));
    expect(JSON.stringify(res.body)).not.toContain("lastSeen");
  });
});
