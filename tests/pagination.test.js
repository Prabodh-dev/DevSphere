import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import Follow from "../models/Follow.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import User from "../models/User.js";
import { decodeCursor, encodeCursor } from "../utils/pagination.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";
import { expectError } from "./helpers/errors.js";

let alice;
let bob;
let admin;
let chat;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  admin = await makeAdmin(await createUser());
  chat = await Chat.create({ members: [alice.id, bob.id] });
});

const get = (user, path) => request(app).get(path).set(bearer(user.token));
const at = (n) => new Date(Date.UTC(2025, 0, 1, 0, 0, n));
const id = () => new mongoose.Types.ObjectId();

// Reads every page of a list and returns the pages.
async function readAll(user, path, limit = 2) {
  const pages = [];
  let cursor;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await get(user, url);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["items", "nextCursor"]);
    pages.push(res.body);
    cursor = res.body.nextCursor;
    expect(pages.length).toBeLessThan(20);
  } while (cursor);
  return pages;
}

describe("cursors", () => {
  it("are opaque and round trip", () => {
    const cursor = encodeCursor({ value: at(5), id: id() });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const parsed = decodeCursor(cursor, "date");
    expect(parsed.value).toEqual(at(5));
    expect(parsed.id).toBeInstanceOf(mongoose.Types.ObjectId);

    const idOnly = encodeCursor({ id: id() });
    expect(decodeCursor(idOnly, "id").value).toBeNull();
  });

  it("reject anything that is not a cursor", () => {
    const good = encodeCursor({ value: at(1), id: id() });
    const b64 = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const bad = [
      "",
      "not a cursor",
      "%%%",
      Buffer.from("plain text").toString("base64url"),
      b64({ v: "yesterday", i: String(id()) }),
      b64({ v: 1, i: "short" }),
      b64({ v: 1 }),
      b64([1, 2]),
      b64({ v: { $gt: 0 }, i: String(id()) }),
      good.slice(0, -4),
    ];
    for (const cursor of bad) {
      expect(() => decodeCursor(cursor, "date"), cursor).toThrow(
        /Invalid cursor/
      );
    }
    // A cursor made for another kind of list is refused too.
    expect(() => decodeCursor(encodeCursor({ id: id() }), "date")).toThrow();
    expect(() => decodeCursor(good, "id")).toThrow();
  });
});

describe("limit and cursor parameters", () => {
  const endpoints = [
    "/api/v1/chat",
    "/api/v1/notifications",
    "/api/v1/status/feed",
    "/api/v1/users?tag=go",
  ];

  it.each(endpoints)("%s validates limit", async (path) => {
    const sep = path.includes("?") ? "&" : "?";
    for (const limit of ["0", "101", "-1", "abc", "1.5"]) {
      const res = await get(alice, `${path}${sep}limit=${limit}`);
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.error.details[0]).toMatchObject({
        field: "limit",
        location: "query",
      });
    }
  });

  it.each(endpoints)("%s answers 400 for an invalid cursor", async (path) => {
    const sep = path.includes("?") ? "&" : "?";
    const res = await get(alice, `${path}${sep}cursor=garbage`);
    expectError(res, 400, "INVALID_CURSOR", "Invalid cursor");
  });

  it("defaults to 30 items and allows up to 100", async () => {
    await Message.insertMany(
      Array.from({ length: 105 }, (_, i) => ({
        chat: chat.id,
        sender: bob.id,
        text: `m${i}`,
        createdAt: at(i),
      }))
    );
    const path = `/api/v1/chat/message/${chat.id}`;

    const first = await get(alice, path);
    expect(first.body.items).toHaveLength(30);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const max = await get(alice, `${path}?limit=100`);
    expect(max.body.items).toHaveLength(100);
    expect((await get(alice, `${path}?limit=101`)).status).toBe(400);
  });

  it("ignores the old skip parameter", async () => {
    const carol = await createUser();
    await Follow.create({ follower: alice.id, following: carol.id });
    await Follow.create({ follower: bob.id, following: carol.id });
    const res = await get(alice, `/api/v1/users/${carol.id}/followers?skip=1`);
    expect(res.body.items).toHaveLength(2);
  });
});

describe("chat messages", () => {
  beforeEach(async () => {
    await Message.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        chat: chat.id,
        sender: i % 2 ? alice.id : bob.id,
        text: `m${i}`,
        createdAt: at(i),
      }))
    );
  });
  const path = () => `/api/v1/chat/message/${chat.id}`;

  it("come newest first and page back in time", async () => {
    const pages = await readAll(alice, path());
    expect(pages.map((p) => p.items.map((m) => m.text))).toEqual([
      ["m4", "m3"],
      ["m2", "m1"],
      ["m0"],
    ]);
    expect(pages[0].nextCursor).toEqual(expect.any(String));
    expect(pages[2].nextCursor).toBeNull();
  });

  it("have a null cursor when everything fits in one page", async () => {
    const res = await get(alice, `${path()}?limit=50`);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.nextCursor).toBeNull();
  });

  it("do not skip or repeat messages created at the same moment", async () => {
    await Message.deleteMany({});
    await Message.insertMany(
      Array.from({ length: 7 }, (_, i) => ({
        chat: chat.id,
        sender: bob.id,
        text: `same${i}`,
        createdAt: at(1),
      }))
    );
    const pages = await readAll(alice, path(), 3);
    const texts = pages.flatMap((p) => p.items.map((m) => m.text));
    expect(texts).toHaveLength(7);
    expect(new Set(texts).size).toBe(7);
  });

  it("stay stable while new messages arrive", async () => {
    const first = await get(alice, `${path()}?limit=2`);
    expect(first.body.items.map((m) => m.text)).toEqual(["m4", "m3"]);

    // Two newer messages arrive between the requests.
    await Message.insertMany([
      { chat: chat.id, sender: bob.id, text: "new1", createdAt: at(10) },
      { chat: chat.id, sender: bob.id, text: "new2", createdAt: at(11) },
    ]);

    const second = await get(
      alice,
      `${path()}?limit=2&cursor=${first.body.nextCursor}`
    );
    expect(second.body.items.map((m) => m.text)).toEqual(["m2", "m1"]);

    const fresh = await get(alice, `${path()}?limit=2`);
    expect(fresh.body.items.map((m) => m.text)).toEqual(["new2", "new1"]);
  });

  it("keep the membership rule", async () => {
    const outsider = await createUser();
    expectError(await get(outsider, path()), 403, "FORBIDDEN");
  });
});

describe("chats", () => {
  it("are listed by recent activity", async () => {
    const chats = [];
    for (let i = 0; i < 5; i++) {
      const other = await createUser();
      chats.push(
        await Chat.create({
          members: [alice.id, other.id],
          updatedAt: at(i + 1),
        })
      );
    }
    await Chat.collection.updateMany(
      { _id: chat._id },
      { $set: { updatedAt: at(0) } }
    );
    // Chat.create stamps updatedAt itself, so set the times directly.
    for (let i = 0; i < 5; i++) {
      await Chat.collection.updateOne(
        { _id: chats[i]._id },
        { $set: { updatedAt: at(i + 1) } }
      );
    }

    const pages = await readAll(alice, "/api/v1/chat");
    const ids = pages.flatMap((p) => p.items.map((c) => c._id));
    expect(ids).toEqual(
      [...chats]
        .reverse()
        .map((c) => c.id)
        .concat(chat.id)
    );
    expect(pages.at(-1).nextCursor).toBeNull();
  });
});

describe("notifications", () => {
  it("are paged newest first", async () => {
    await Notification.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        user: alice.id,
        type: "status",
        content: `n${i}`,
        createdAt: at(i),
      }))
    );
    await Notification.create({
      user: bob.id,
      type: "status",
      content: "other",
    });

    const pages = await readAll(alice, "/api/v1/notifications");
    expect(pages.flatMap((p) => p.items.map((n) => n.content))).toEqual([
      "n4",
      "n3",
      "n2",
      "n1",
      "n0",
    ]);
  });
});

describe("status feed", () => {
  it("is paged newest first and hides expired statuses", async () => {
    const future = new Date(Date.now() + 3600 * 1000);
    await Status.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        user: alice.id,
        type: "text",
        content: `s${i}`,
        visibleUntil: future,
        expiresAt: future,
        createdAt: at(i),
      }))
    );
    await Status.create({
      user: alice.id,
      type: "text",
      content: "gone",
      visibleUntil: new Date(Date.now() - 1000),
      expiresAt: future,
    });

    const pages = await readAll(alice, "/api/v1/status/feed");
    expect(pages.flatMap((p) => p.items.map((s) => s.content))).toEqual([
      "s4",
      "s3",
      "s2",
      "s1",
      "s0",
    ]);
  });
});

describe("tag search", () => {
  it("is paged in creation order", async () => {
    const names = [];
    for (let i = 0; i < 5; i++) {
      const user = await createUser();
      await User.updateOne({ _id: user.id }, { tags: ["go"] });
      names.push(user.username);
    }
    const pages = await readAll(alice, "/api/v1/users?tag=go");
    expect(pages.flatMap((p) => p.items.map((u) => u.username))).toEqual(names);
    expect(pages[0].items[0]).toHaveProperty("tags");
  });
});

describe("followers and following", () => {
  it("are paged newest first", async () => {
    const target = await createUser();
    const followers = [];
    for (let i = 0; i < 5; i++) {
      const user = await createUser();
      followers.push(user);
      await Follow.collection.insertOne({
        follower: new mongoose.Types.ObjectId(user.id),
        following: new mongoose.Types.ObjectId(target.id),
        createdAt: at(i),
      });
    }

    const pages = await readAll(alice, `/api/v1/users/${target.id}/followers`);
    expect(pages.flatMap((p) => p.items.map((u) => u.username))).toEqual(
      [...followers].reverse().map((u) => u.username)
    );

    const following = await readAll(
      alice,
      `/api/v1/users/${followers[0].id}/following`
    );
    expect(following.flatMap((p) => p.items.map((u) => u.username))).toEqual([
      target.username,
    ]);
  });

  it("keep paging when an account was deleted", async () => {
    const target = await createUser();
    const users = [];
    for (let i = 0; i < 4; i++) {
      const user = await createUser();
      users.push(user);
      await Follow.collection.insertOne({
        follower: new mongoose.Types.ObjectId(user.id),
        following: new mongoose.Types.ObjectId(target.id),
        createdAt: at(i),
      });
    }
    await User.deleteOne({ _id: users[3].id });

    const pages = await readAll(alice, `/api/v1/users/${target.id}/followers`);
    const names = pages.flatMap((p) => p.items.map((u) => u.username));
    expect(names).toEqual([
      users[2].username,
      users[1].username,
      users[0].username,
    ]);
  });
});

describe("admin lists", () => {
  it("page through users, newest first", async () => {
    const extra = [];
    for (let i = 0; i < 4; i++) extra.push(await createUser());

    const pages = await readAll(admin, "/api/v1/admin/users");
    const names = pages.flatMap((p) => p.items.map((u) => u.username));
    expect(names).toHaveLength(7);
    expect(names.slice(0, 4)).toEqual(
      [...extra].reverse().map((u) => u.username)
    );
    expect(JSON.stringify(pages)).not.toContain("password");
  });

  it("page through reports and keep the status filter", async () => {
    for (let i = 0; i < 5; i++) {
      await Report.create({
        reportedBy: alice.id,
        targetType: "user",
        targetId: id(),
        reason: `r${i}`,
        createdAt: at(i),
      });
    }
    await Report.create({
      reportedBy: bob.id,
      targetType: "user",
      targetId: id(),
      reason: "done",
      status: "resolved",
      createdAt: at(20),
    });

    const open = await readAll(admin, "/api/v1/admin/reports");
    expect(open.flatMap((p) => p.items.map((r) => r.reason))).toEqual([
      "r4",
      "r3",
      "r2",
      "r1",
      "r0",
    ]);
    const all = await readAll(admin, "/api/v1/admin/reports?status=all");
    expect(all.flatMap((p) => p.items)).toHaveLength(6);
  });

  it("are still admin only", async () => {
    expectError(await get(alice, "/api/v1/admin/users"), 403, "FORBIDDEN");
  });
});
