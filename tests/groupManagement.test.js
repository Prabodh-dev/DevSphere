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
import mongoose from "mongoose";
import { sentCommands } from "./helpers/aws.js";

const send = vi.hoisted(() => vi.fn());
vi.mock("../utils/s3.js", () => ({
  getS3Client: () => ({ send }),
  isUploadConfigured: () => Boolean(process.env.AVATAR_BUCKET),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://signed.example.test/x"),
}));

const { default: app } = await import("../app.js");
const { default: Chat } = await import("../models/Chat.js");
const { default: ChatRead } = await import("../models/ChatRead.js");
const { default: LiveCode } = await import("../models/LiveCode.js");
const { default: Message } = await import("../models/Message.js");
const { default: Notification } = await import("../models/Notification.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser, bearer } = await import("./helpers/users.js");
const { startSocketServer, once, never, sleep, emitAck, collect } =
  await import("./helpers/socket.js");
const { flushLiveCode } = await import("../services/liveCodeService.js");

let server;
let alice; // admin
let bob; // member
let carol; // member
let dave; // outsider
let group;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
});
afterAll(async () => {
  await server.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue({});
  process.env.AVATAR_BUCKET = "example-bucket";
  app.set("io", server.io);
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  dave = await createUser();
  group = await Chat.create({
    isGroupChat: true,
    chatName: "team",
    members: [alice.id, bob.id, carol.id],
    admins: [alice.id],
  });
});

const call = (method, user, path, body) => {
  const req = request(app)
    [method](`/api/v1/group${path}`)
    .set(bearer(user.token));
  return body ? req.send(body) : req;
};
const fresh = () => Chat.findById(group.id);
const ids = (list) => list.map(String).sort();

// A connection that has joined the group's chat and live code rooms.
async function joined(user, chatId = group.id) {
  const socket = await server.client(user);
  socket.emit("join-chat", chatId);
  socket.emit("join-live-code", { chatId });
  await sleep(200);
  return socket;
}

describe("PATCH /api/v1/group/leave", () => {
  it("lets a member leave and take their connections out of the rooms", async () => {
    const onBob = await joined(bob);
    const onAlice = await joined(alice);

    const res = await call("patch", bob, "/leave", { chatId: group.id });
    expect(res.status).toBe(200);
    expect(ids((await fresh()).members)).toEqual(ids([alice.id, carol.id]));

    const silent = [
      never(onBob, "receive-message"),
      never(onBob, "typing"),
      never(onBob, "code-update"),
    ];
    const sent = await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({ chatId: group.id, text: "after bob left" });
    expect(sent.status).toBe(201);
    onAlice.emit("typing", group.id);
    await emitAck(onAlice, "code-change", {
      chatId: group.id,
      baseRevision: 0,
      code: "x",
    });
    expect((await Promise.all(silent)).every(Boolean)).toBe(true);

    // The group is gone from their list, and they cannot send to it.
    const list = await request(app).get("/api/v1/chat").set(bearer(bob.token));
    expect(list.body.items).toEqual([]);
    const refused = await emitAck(onBob, "send-message", {
      chatId: group.id,
      text: "still here?",
    });
    expect(refused.error.code).toBe("FORBIDDEN");
  });

  it("tells the group, and the person who left, with group-updated", async () => {
    const onAlice = await joined(alice);
    const onBob = await joined(bob);
    const toGroup = once(onAlice, "group-updated");
    const toBob = once(onBob, "group-updated");
    await call("patch", bob, "/leave", { chatId: group.id });
    const expected = {
      chatId: group.id,
      change: "member-left",
      userId: bob.id,
    };
    expect(await toGroup).toEqual(expected);
    expect(await toBob).toEqual(expected);
  });

  it("is refused for the last admin until they promote someone", async () => {
    const stuck = await call("patch", alice, "/leave", { chatId: group.id });
    expect(stuck.status).toBe(400);
    expect(ids((await fresh()).members)).toHaveLength(3);

    await call("patch", alice, "/promote", {
      chatId: group.id,
      userId: bob.id,
    });
    const ok = await call("patch", alice, "/leave", { chatId: group.id });
    expect(ok.status).toBe(200);
    const after = await fresh();
    expect(ids(after.members)).toEqual(ids([bob.id, carol.id]));
    expect(ids(after.admins)).toEqual(ids([bob.id]));
  });

  it("lets one of several admins leave", async () => {
    await Chat.updateOne({ _id: group.id }, { admins: [alice.id, bob.id] });
    expect(
      (await call("patch", alice, "/leave", { chatId: group.id })).status
    ).toBe(200);
    expect(ids((await fresh()).admins)).toEqual(ids([bob.id]));
  });

  it("is refused for non-members, one-to-one chats and unknown groups", async () => {
    expect(
      (await call("patch", dave, "/leave", { chatId: group.id })).status
    ).toBe(403);
    const direct = await Chat.create({ members: [alice.id, bob.id] });
    expect(
      (await call("patch", bob, "/leave", { chatId: direct.id })).status
    ).toBe(400);
    const missing = new mongoose.Types.ObjectId().toString();
    expect(
      (await call("patch", bob, "/leave", { chatId: missing })).status
    ).toBe(404);
    expect(
      (await call("patch", bob, "/leave", { chatId: "nope" })).status
    ).toBe(400);
  });
});

describe("admins", () => {
  it("promotes and demotes members", async () => {
    const up = await call("patch", alice, "/promote", {
      chatId: group.id,
      userId: bob.id,
    });
    expect(up.status).toBe(200);
    expect(ids((await fresh()).admins)).toEqual(ids([alice.id, bob.id]));

    // The new admin can use admin rights.
    const added = await call("patch", bob, "/rename", {
      chatId: group.id,
      newName: "renamed by bob",
    });
    expect(added.status).toBe(200);

    const down = await call("patch", bob, "/demote", {
      chatId: group.id,
      userId: alice.id,
    });
    expect(down.status).toBe(200);
    expect(ids((await fresh()).admins)).toEqual(ids([bob.id]));
  });

  it("refuses promoting twice, promoting outsiders and demoting non-admins", async () => {
    await call("patch", alice, "/promote", {
      chatId: group.id,
      userId: bob.id,
    });
    const twice = await call("patch", alice, "/promote", {
      chatId: group.id,
      userId: bob.id,
    });
    expect(twice.status).toBe(400);
    const outsider = await call("patch", alice, "/promote", {
      chatId: group.id,
      userId: dave.id,
    });
    expect(outsider.status).toBe(400);
    const member = await call("patch", alice, "/demote", {
      chatId: group.id,
      userId: carol.id,
    });
    expect(member.status).toBe(400);
  });

  it("keeps at least one admin", async () => {
    const res = await call("patch", alice, "/demote", {
      chatId: group.id,
      userId: alice.id,
    });
    expect(res.status).toBe(400);
    expect(ids((await fresh()).admins)).toEqual(ids([alice.id]));
  });

  it("is only for admins of a group", async () => {
    const body = { chatId: group.id, userId: carol.id };
    expect((await call("patch", bob, "/promote", body)).status).toBe(403);
    expect((await call("patch", dave, "/promote", body)).status).toBe(403);
    expect(
      (await call("patch", bob, "/demote", { ...body, userId: alice.id }))
        .status
    ).toBe(403);
    const direct = await Chat.create({ members: [alice.id, bob.id] });
    expect(
      (
        await call("patch", alice, "/promote", {
          chatId: direct.id,
          userId: bob.id,
        })
      ).status
    ).toBe(400);
    expect(ids((await fresh()).admins)).toEqual(ids([alice.id]));
  });

  it("announces the change to the group", async () => {
    const onBob = await joined(bob);
    const heard = once(onBob, "group-updated");
    await call("patch", alice, "/promote", {
      chatId: group.id,
      userId: carol.id,
    });
    expect(await heard).toEqual({
      chatId: group.id,
      change: "admin-promoted",
      userId: carol.id,
    });
  });
});

describe("removing members and renaming", () => {
  it("removes a member and takes their connections out of the rooms at once", async () => {
    const onCarol = await joined(carol);
    const heard = once(onCarol, "group-updated");
    const res = await call("patch", alice, "/remove", {
      chatId: group.id,
      userId: carol.id,
    });
    expect(res.status).toBe(200);
    expect(await heard).toMatchObject({
      change: "member-removed",
      userId: carol.id,
    });

    const silent = never(onCarol, "receive-message");
    await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({ chatId: group.id, text: "gone" });
    expect(await silent).toBe(true);
  });

  it("only lets admins remove members", async () => {
    const res = await call("patch", bob, "/remove", {
      chatId: group.id,
      userId: carol.id,
    });
    expect(res.status).toBe(403);
    expect(ids((await fresh()).members)).toHaveLength(3);
  });

  it("announces renames", async () => {
    const onBob = await joined(bob);
    const heard = once(onBob, "group-updated");
    await call("patch", alice, "/rename", {
      chatId: group.id,
      newName: "crew",
    });
    expect(await heard).toEqual({
      chatId: group.id,
      change: "renamed",
      chatName: "crew",
    });
    expect((await fresh()).chatName).toBe("crew");
  });
});

describe("DELETE /api/v1/group/:chatId", () => {
  async function fill() {
    const messages = await Message.create([
      { chat: group.id, sender: bob.id, text: "hello @" + carol.username },
      {
        chat: group.id,
        sender: bob.id,
        type: "media",
        media: {
          mimeType: "image/png",
          key: "chat/one.png",
          size: 10,
          fileName: "a.png",
        },
      },
      {
        chat: group.id,
        sender: carol.id,
        type: "media",
        media: {
          mimeType: "application/pdf",
          key: "chat/two.pdf",
          size: 10,
          fileName: "b.pdf",
        },
      },
    ]);
    await ChatRead.create({
      chat: group.id,
      user: carol.id,
      lastReadMessage: messages[0].id,
      lastReadAt: messages[0].createdAt,
    });
    await Notification.create([
      { user: carol.id, type: "group", chatId: group.id, fromUser: alice.id },
      {
        user: carol.id,
        type: "mention",
        chatId: group.id,
        messageId: messages[0].id,
        fromUser: bob.id,
      },
      { user: alice.id, type: "follow", fromUser: bob.id },
    ]);
    await LiveCode.create({ chatId: group.id, code: "stored", revision: 1 });
  }

  it("removes the group and everything that belongs to it", async () => {
    await fill();
    // An edit that has not been saved yet must not bring the document back.
    const onBob = await joined(bob);
    await emitAck(onBob, "code-change", {
      chatId: group.id,
      baseRevision: 1,
      code: "unsaved",
    });

    const res = await call("delete", alice, `/${group.id}`);
    expect(res.status).toBe(200);
    await flushLiveCode();

    expect(await Chat.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
    expect(await ChatRead.countDocuments()).toBe(0);
    expect(await LiveCode.countDocuments()).toBe(0);
    // Only the notification about something else is left.
    expect((await Notification.find()).map((n) => n.type)).toEqual(["follow"]);

    const deleted = sentCommands(send)
      .filter((c) => c.name === "DeleteObjectCommand")
      .map((c) => c.Key)
      .sort();
    expect(deleted).toEqual(["chat/one.png", "chat/two.pdf"]);
  });

  it("tells the members and takes their connections out of the rooms", async () => {
    await fill();
    const onBob = await joined(bob);
    const onCarol = await server.client(carol); // never joined the chat room
    const heardBob = once(onBob, "group-updated");
    const heardCarol = once(onCarol, "group-updated");

    await call("delete", alice, `/${group.id}`);
    expect(await heardBob).toEqual({ chatId: group.id, change: "deleted" });
    expect(await heardCarol).toEqual({ chatId: group.id, change: "deleted" });

    const rooms = await server.io.local.in(`chat:${group.id}`).fetchSockets();
    expect(rooms).toHaveLength(0);
    const live = await server.io.local.in(`live:${group.id}`).fetchSockets();
    expect(live).toHaveLength(0);
    const typing = collect(onBob, "typing", 300);
    onBob.emit("typing", group.id);
    expect(await typing).toEqual([]);
  });

  it("is only for admins of a group", async () => {
    await fill();
    expect((await call("delete", bob, `/${group.id}`)).status).toBe(403);
    expect((await call("delete", dave, `/${group.id}`)).status).toBe(403);
    const direct = await Chat.create({ members: [alice.id, bob.id] });
    expect((await call("delete", alice, `/${direct.id}`)).status).toBe(400);
    const missing = new mongoose.Types.ObjectId().toString();
    expect((await call("delete", alice, `/${missing}`)).status).toBe(404);
    expect((await call("delete", alice, "/nope")).status).toBe(400);

    expect(await Chat.countDocuments({ _id: group.id })).toBe(1);
    expect(await Message.countDocuments()).toBe(3);
    expect(sentCommands(send)).toHaveLength(0);
  });

  it("can be done by a second admin, and only once", async () => {
    await Chat.updateOne({ _id: group.id }, { admins: [alice.id, bob.id] });
    expect((await call("delete", bob, `/${group.id}`)).status).toBe(200);
    expect((await call("delete", bob, `/${group.id}`)).status).toBe(404);
  });
});
