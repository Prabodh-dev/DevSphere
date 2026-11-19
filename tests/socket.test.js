import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { startSocketServer, once, never, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

let server;
let alice;
let bob;
let carol;
let chat;

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
  chat = await Chat.create({ members: [alice.id, bob.id] });
});

describe("handshake", () => {
  it("accepts a valid token", async () => {
    const { connected } = await server.tryConnect({ token: alice.token });
    expect(connected).toBe(true);
  });

  it("refuses missing, malformed and forged tokens", async () => {
    const forged = jwt.sign(
      { userId: alice.id },
      "some-other-secret-value-0123456789"
    );
    for (const auth of [
      {},
      { token: "" },
      { token: "not-a-token" },
      { token: forged },
      { token: { $ne: null } },
    ]) {
      const { connected, error } = await server.tryConnect(auth);
      expect(connected).toBe(false);
      expect(error).toBe("Authentication failed");
    }
  });

  it("refuses expired tokens and tokens of deleted users", async () => {
    const expired = jwt.sign({ userId: alice.id }, process.env.JWT_SECRET, {
      expiresIn: -10,
    });
    expect((await server.tryConnect({ token: expired })).connected).toBe(false);

    await User.deleteOne({ _id: carol.id });
    expect((await server.tryConnect({ token: carol.token })).connected).toBe(
      false
    );
  });

  it("refuses blocked users", async () => {
    await User.updateOne({ _id: bob.id }, { isBlocked: true });
    const { connected } = await server.tryConnect({ token: bob.token });
    expect(connected).toBe(false);
  });

  it("ignores a user id supplied by the client", async () => {
    const a = await server.client(alice, { query: { userId: bob.id } });
    const b = await server.client(bob);
    await sleep(100);

    a.emit("join-chat", chat.id);
    b.emit("join-chat", chat.id);
    await sleep(100);

    // Typing events carry the verified identity.
    const typing = once(b, "typing");
    a.emit("typing", chat.id);
    expect(await typing).toBe(alice.id);
  });

  it("disconnects a user who gets blocked while connected", async () => {
    const admin = await makeAdmin(await createUser());
    const target = await server.client(bob);
    const closed = once(target, "disconnect");

    const res = await request(app)
      .patch(`/api/v1/admin/block/${bob.id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    await closed;
    expect(target.connected).toBe(false);
  });

  it("announces verified presence to other users", async () => {
    const a = await server.client(alice);
    const online = once(a, "user-online");
    await server.client(bob);
    expect(await online).toBe(bob.id);
  });
});

describe("chat events", () => {
  it("answers a non-member's join with an error", async () => {
    const c = await server.client(carol);
    const error = once(c, "socket-error");
    c.emit("join-chat", chat.id);
    expect(await error).toEqual({
      event: "join-chat",
      error: { code: "FORBIDDEN", message: "Not a member of this chat" },
    });
  });

  it("refuses sends, group messages and typing from non-members", async () => {
    const a = await server.client(alice);
    const c = await server.client(carol);
    a.emit("join-chat", chat.id);
    await sleep(100);

    const heard = ["receive-message", "typing", "stop-typing"].map((event) =>
      never(a, event, 500)
    );
    const errors = [];
    c.on("socket-error", (e) => errors.push(e.event));

    c.emit("send-message", { chatId: chat.id, text: "x" });
    c.emit("group-message", { chatId: chat.id, text: "x" });
    c.emit("typing", chat.id);
    c.emit("stop-typing", chat.id);
    await sleep(300);

    expect((await Promise.all(heard)).every(Boolean)).toBe(true);
    expect(errors.sort()).toEqual([
      "group-message",
      "send-message",
      "stop-typing",
      "typing",
    ]);
  });

  it("do not let clients pick room names", async () => {
    const c = await server.client(carol);
    const errors = [];
    c.on("socket-error", (e) => errors.push(e));

    c.emit("join-chat", `user:${alice.id}`);
    c.emit("join-chat", `live:${chat.id}`);
    c.emit("join-chat", alice.id); // a user id is not a chat
    c.emit("join-chat", "any-room-name");
    await sleep(300);

    expect(errors).toHaveLength(4);

    const a = await server.client(alice);
    const spy = never(c, "receive-notification");
    a.emit("send-notification", { toUserId: alice.id, notification: { x: 1 } });
    expect(await spy).toBe(true);
  });

  it("stop delivering to someone removed from a group", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
    const a = await server.client(alice);
    const c = await server.client(carol);
    a.emit("join-chat", group.id);
    c.emit("join-chat", group.id);
    await sleep(150);

    const removed = await request(app)
      .patch("/api/v1/group/remove")
      .set(bearer(alice.token))
      .send({ chatId: group.id, userId: carol.id });
    expect(removed.status).toBe(200);

    const silent = never(c, "receive-message");
    a.emit("send-message", { chatId: group.id, text: "secret" });
    expect(await silent).toBe(true);

    const error = once(c, "socket-error");
    c.emit("send-message", { chatId: group.id, text: "still here?" });
    expect(await error).toMatchObject({ event: "send-message" });
  });
});

describe("notifications", () => {
  it("reach only the verified user's own room", async () => {
    const a = await server.client(alice);
    const b = await server.client(bob);
    const c = await server.client(carol);

    const received = once(b, "receive-notification");
    const others = [
      never(a, "receive-notification"),
      never(c, "receive-notification"),
    ];

    await request(app)
      .post(`/api/v1/users/${bob.id}/follow`)
      .set(bearer(alice.token));

    expect(await received).toMatchObject({ type: "follow" });
    expect(await Promise.all(others)).toEqual([true, true]);
  });

  it("are delivered to every open connection of that user", async () => {
    const tab1 = await server.client(bob);
    const tab2 = await server.client(bob);
    const both = Promise.all([
      once(tab1, "receive-notification"),
      once(tab2, "receive-notification"),
    ]);

    await request(app)
      .post(`/api/v1/users/${bob.id}/follow`)
      .set(bearer(alice.token));
    const [one, two] = await both;
    expect(one.type).toBe("follow");
    expect(two.type).toBe("follow");
  });

  it("cannot be sent by clients", async () => {
    const a = await server.client(alice);
    const b = await server.client(bob);
    const silent = never(b, "receive-notification");
    a.emit("send-notification", {
      toUserId: bob.id,
      notification: { type: "follow", content: "hello" },
    });
    expect(await silent).toBe(true);
  });
});

describe("payload limits", () => {
  it("rejects oversized messages and code", async () => {
    const a = await server.client(alice);
    a.emit("join-chat", chat.id);
    await sleep(100);

    const errors = [];
    a.on("socket-error", (e) => errors.push(e.event));
    a.emit("send-message", { chatId: chat.id, text: "x".repeat(5001) });
    a.emit("code-change", {
      chatId: chat.id,
      baseRevision: 0,
      code: "x".repeat(100001),
    });
    await sleep(300);

    expect(errors.sort()).toEqual(["code-change", "send-message"]);
  });

  it("closes connections that send packets beyond the transport limit", async () => {
    const a = await server.client(alice);
    const closed = once(a, "disconnect", 5000);
    a.emit("send-message", { chatId: chat.id, text: "x".repeat(700 * 1024) });
    await closed;
    expect(a.connected).toBe(false);
  });

  it("ignores malformed payloads for every event", async () => {
    const a = await server.client(alice);
    const errors = [];
    a.on("socket-error", (e) => errors.push(e.event));

    a.emit("join-chat", { $ne: null });
    a.emit("send-message", null);
    a.emit("send-message", { chatId: "nope", text: "x" });
    a.emit("group-message", "text");
    a.emit("typing", 42);
    a.emit("stop-typing");
    a.emit("join-live-code", { chatId: { $ne: null } });
    a.emit("code-change");
    await sleep(500);

    expect(errors).toHaveLength(8);

    const b = await server.client(bob);
    a.emit("join-chat", chat.id);
    b.emit("join-chat", chat.id);
    await sleep(150);
    const received = once(b, "receive-message");
    a.emit("send-message", { chatId: chat.id, text: "still here" });
    expect((await received).text).toBe("still here");
  });
});
