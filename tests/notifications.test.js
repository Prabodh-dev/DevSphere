import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Notification, { NOTIFICATION_TYPES } from "../models/Notification.js";
import User from "../models/User.js";
import * as R from "../schemas/responses.js";
import { notifyUser } from "../services/notificationService.js";
import { extractMentions } from "../services/mentionService.js";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let server;
let alice;
let bob;
let carol;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
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

const get = (user, url) =>
  request(app).get(`/api/v1/notifications${url}`).set(bearer(user.token));
const patch = (user, url) =>
  request(app).patch(`/api/v1/notifications${url}`).set(bearer(user.token));
const follow = (actor, target) =>
  request(app)
    .post(`/api/v1/users/${target.id}/follow`)
    .set(bearer(actor.token));
const send = (user, chatId, text) =>
  request(app)
    .post("/api/v1/chat/message")
    .set(bearer(user.token))
    .send({ chatId, text });

describe("notification kinds", () => {
  it("are listed in the model, the API docs and the README", () => {
    expect(NOTIFICATION_TYPES).toEqual(
      expect.arrayContaining(["follow", "group", "like", "reply", "mention"])
    );
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    for (const type of ["follow", "like", "reply", "mention", "group"]) {
      expect(readme, type).toContain(`\`${type}\``);
    }
    expect(R.NotificationItem.safeParse({ type: "nonsense" }).success).toBe(
      false
    );
  });

  it("refuse an unknown kind", async () => {
    await expect(
      Notification.create({ user: alice.id, type: "poke" })
    ).rejects.toThrow();
  });
});

describe("notifyUser", () => {
  it("never notifies someone about their own action", async () => {
    const result = await notifyUser(server.io, {
      userId: alice.id,
      type: "follow",
      fromUser: alice.id,
    });
    expect(result).toBeNull();
    expect(await Notification.countDocuments()).toBe(0);
  });

  it("collapses notifications that share a key, even when they race", async () => {
    const make = () =>
      notifyUser(server.io, {
        userId: bob.id,
        type: "like",
        fromUser: alice.id,
        dedupeKey: "like:abc",
      });
    await Notification.init();
    const results = await Promise.all([make(), make(), make()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await Notification.countDocuments({ user: bob.id })).toBe(1);

    // The same key for another recipient is a different notification.
    await notifyUser(server.io, {
      userId: carol.id,
      type: "like",
      fromUser: alice.id,
      dedupeKey: "like:abc",
    });
    expect(await Notification.countDocuments()).toBe(2);
  });

  it("pushes to the recipient's sockets only, and not for a collapsed one", async () => {
    const onBob = await server.client(bob);
    const onCarol = await server.client(carol);
    const leaked = never(onCarol, "receive-notification");
    const pushed = once(onBob, "receive-notification");

    await notifyUser(server.io, {
      userId: bob.id,
      type: "like",
      fromUser: alice.id,
      content: "liked",
      dedupeKey: "k",
    });
    expect(await pushed).toMatchObject({ type: "like", seen: false });
    expect(await leaked).toBe(true);

    const again = never(onBob, "receive-notification");
    await notifyUser(server.io, {
      userId: bob.id,
      type: "like",
      fromUser: alice.id,
      dedupeKey: "k",
    });
    expect(await again).toBe(true);
  });
});

describe("followers", () => {
  it("are notified live, once, even after an unfollow and a new follow", async () => {
    const onBob = await server.client(bob);
    const pushed = once(onBob, "receive-notification");
    expect((await follow(alice, bob)).status).toBe(200);
    expect(await pushed).toMatchObject({
      type: "follow",
      fromUser: { _id: alice.id },
    });

    await request(app)
      .delete(`/api/v1/users/${bob.id}/unfollow`)
      .set(bearer(alice.token));
    await follow(alice, bob);
    expect(await Notification.countDocuments({ user: bob.id })).toBe(1);
  });
});

describe("GET /api/v1/notifications/unread-count", () => {
  it("counts unread notifications and needs a login", async () => {
    expect((await get(bob, "/unread-count")).body).toEqual({ unreadCount: 0 });
    await follow(alice, bob);
    await follow(carol, bob);
    const res = await get(bob, "/unread-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unreadCount: 2 });
    expect(R.UnreadCount.safeParse(res.body).success).toBe(true);
    expect((await get(alice, "/unread-count")).body.unreadCount).toBe(0);

    const anonymous = await request(app).get(
      "/api/v1/notifications/unread-count"
    );
    expect(anonymous.status).toBe(401);
  });
});

describe("marking notifications read", () => {
  it("marks one read, repeatably, and lowers the count", async () => {
    await follow(alice, bob);
    await follow(carol, bob);
    const list = (await get(bob, "")).body.items;
    expect(list.every((n) => n.seen === false)).toBe(true);

    const res = await patch(bob, `/${list[0]._id}/read`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ _id: list[0]._id, seen: true });
    expect(R.NotificationItem.safeParse(res.body).error?.issues ?? []).toEqual(
      []
    );
    expect((await patch(bob, `/${list[0]._id}/read`)).status).toBe(200);
    expect((await get(bob, "/unread-count")).body.unreadCount).toBe(1);
  });

  it("does not touch other people's notifications", async () => {
    await follow(alice, bob);
    const [mine] = (await get(bob, "")).body.items;

    const res = await patch(carol, `/${mine._id}/read`);
    expect(res.status).toBe(404);
    expect((await Notification.findById(mine._id)).seen).toBe(false);

    const missing = new mongoose.Types.ObjectId().toString();
    expect((await patch(bob, `/${missing}/read`)).status).toBe(404);
    expect((await patch(bob, "/nope/read")).status).toBe(400);
  });

  it("marks all of a user's notifications read, and only theirs", async () => {
    await follow(alice, bob);
    await follow(carol, bob);
    await follow(bob, alice);

    const res = await patch(bob, "/read-all");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect((await get(bob, "/unread-count")).body.unreadCount).toBe(0);
    expect((await get(alice, "/unread-count")).body.unreadCount).toBe(1);
    expect((await patch(bob, "/read-all")).body).toEqual({ updated: 0 });
  });
});

describe("mentions", () => {
  let group;
  beforeEach(async () => {
    group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id],
      admins: [alice.id],
    });
  });

  it("finds @usernames in text", () => {
    expect(extractMentions("hi @ada_l and @bob-1, thanks @carol.")).toEqual([
      "ada_l",
      "bob-1",
      "carol",
    ]);
    expect(extractMentions("mail ada@example.com or @@x or @ab")).toEqual([]);
    expect(extractMentions("@dan @dan @dan")).toEqual(["dan"]);
    expect(extractMentions(undefined)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => `@user${i}`).join(" ");
    expect(extractMentions(many)).toHaveLength(20);
  });

  it("notify a mentioned member, live, with the message and chat", async () => {
    const onBob = await server.client(bob);
    const pushed = once(onBob, "receive-notification");

    const res = await send(alice, group.id, `hello @${bob.username}!`);
    expect(res.status).toBe(201);

    const note = await pushed;
    expect(note).toMatchObject({
      type: "mention",
      chatId: group.id,
      messageId: res.body._id,
      seen: false,
      fromUser: { _id: alice.id },
    });
    expect(note.content).toContain(alice.username);
    expect(note.content).toContain("team");
    expect(await Notification.countDocuments({ user: bob.id })).toBe(1);
  });

  it("work for socket messages too, and only once per message", async () => {
    const onAlice = await server.client(alice);
    await new Promise((resolve) => {
      onAlice.emit(
        "send-message",
        {
          chatId: group.id,
          text: `@${bob.username} and again @${bob.username}`,
        },
        resolve
      );
    });
    expect(await Notification.countDocuments({ user: bob.id })).toBe(1);
  });

  it("skip yourself, people outside the chat, blocked users and code", async () => {
    await send(alice, group.id, `note to self @${alice.username}`);
    await send(alice, group.id, `hey @${carol.username}, you are not here`);
    await User.updateOne({ _id: bob.id }, { isBlocked: true });
    await send(alice, group.id, `@${bob.username} blocked`);
    await User.updateOne({ _id: bob.id }, { isBlocked: false });
    await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({
        chatId: group.id,
        type: "code",
        code: { content: `// @${bob.username}` },
      });

    expect(await Notification.countDocuments()).toBe(0);
  });

  it("are removed with the message", async () => {
    const res = await send(alice, group.id, `@${bob.username} look`);
    const admin = await makeAdmin(await createUser());
    expect(await Notification.countDocuments({ messageId: res.body._id })).toBe(
      1
    );

    const removed = await request(app)
      .delete(`/api/v1/admin/remove/message/${res.body._id}`)
      .set(bearer(admin.token));
    expect(removed.status).toBe(200);
    expect(await Notification.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
  });
});

describe("groups", () => {
  it("still notify the people who are added", async () => {
    const res = await request(app)
      .post("/api/v1/group/create")
      .set(bearer(alice.token))
      .send({
        chatName: "crew",
        members: [bob.id, carol.id],
      });
    expect(res.status).toBe(201);
    await sleep(100);
    const notes = await Notification.find({ type: "group" });
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => String(n.chatId) === res.body._id)).toBe(true);
  });
});
