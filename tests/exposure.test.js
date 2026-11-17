import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import request from "supertest";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Notification from "../models/Notification.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

let alice;
let bob;
let carol;
let io;
let emit;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();

  emit = vi.fn();
  io = { to: vi.fn(() => ({ emit })) };
  app.set("io", io);
});

const as = (user) => ({
  get: (p) => request(app).get(p).set(bearer(user.token)),
  post: (p) => request(app).post(p).set(bearer(user.token)),
  patch: (p) => request(app).patch(p).set(bearer(user.token)),
});

const publicKeys = ["_id", "avatar", "username"];

describe("chat responses", () => {
  it("only show public member fields", async () => {
    await Chat.create({ members: [alice.id, bob.id] });
    const res = await as(alice).get("/api/v1/chat");

    expect(res.status).toBe(200);
    expect(res.body.items[0].members).toHaveLength(2);
    for (const member of res.body.items[0].members) {
      expect(Object.keys(member).sort()).toEqual(publicKeys);
    }
    expect(JSON.stringify(res.body)).not.toContain("@example.test");
  });

  it("do the same when a group is created", async () => {
    const res = await as(alice)
      .post("/api/v1/group/create")
      .send({ chatName: "team", members: [bob.id, carol.id] });

    expect(res.status).toBe(201);
    for (const member of res.body.members) {
      expect(Object.keys(member).sort()).toEqual(publicKeys);
    }
    expect(JSON.stringify(res.body)).not.toContain("@example.test");
  });

  it("send only basic chat details with a new message", async () => {
    const chat = await Chat.create({ members: [alice.id, bob.id] });
    const res = await as(alice)
      .post("/api/v1/chat/message")
      .send({ chatId: chat.id, text: "hello" });

    expect(res.status).toBe(201);
    expect(res.body.chat.members).toBeUndefined();
    expect(res.body.chat._id).toBe(chat.id);
  });
});

describe("server side notifications", () => {
  it("are created when someone is followed and pushed to their room", async () => {
    await as(alice).post(`/api/v1/users/${bob.id}/follow`);

    const stored = await Notification.find({ user: bob.id });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ type: "follow" });
    expect(stored[0].fromUser.toString()).toBe(alice.id);

    expect(io.to).toHaveBeenCalledWith(`user:${bob.id}`);
    expect(emit).toHaveBeenCalledWith(
      "receive-notification",
      expect.objectContaining({
        type: "follow",
        fromUser: {
          _id: expect.anything(),
          username: alice.username,
          avatar: "",
        },
      })
    );
  });

  it("are listed for the recipient with public sender details", async () => {
    await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    const res = await as(bob).get("/api/v1/notifications");

    expect(res.body.items).toHaveLength(1);
    expect(Object.keys(res.body.items[0].fromUser).sort()).toEqual(publicKeys);
    expect(
      (await as(alice).get("/api/v1/notifications")).body.items
    ).toHaveLength(0);
  });

  it("are created for members added to a group", async () => {
    const created = await as(alice)
      .post("/api/v1/group/create")
      .send({ chatName: "team", members: [bob.id, carol.id] });
    expect(await Notification.countDocuments({ type: "group" })).toBe(2);

    const dave = await createUser();
    await as(alice)
      .patch("/api/v1/group/add")
      .send({ chatId: created.body._id, userId: dave.id });
    expect(await Notification.countDocuments({ user: dave.id })).toBe(1);
    expect(io.to).toHaveBeenCalledWith(`user:${dave.id}`);
  });

  it("still work when no socket server is attached", async () => {
    app.set("io", undefined);
    const res = await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    expect(res.status).toBe(200);
    expect(await Notification.countDocuments({ user: bob.id })).toBe(1);
  });
});
