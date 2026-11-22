import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Follow from "../models/Follow.js";
import Notification from "../models/Notification.js";
import Status from "../models/Status.js";
import StatusLike from "../models/StatusLike.js";
import StatusReply from "../models/StatusReply.js";
import StatusView from "../models/StatusView.js";
import User from "../models/User.js";
import * as R from "../schemas/responses.js";
import {
  removeNotificationsOfMissingStatuses,
  removeStatus,
} from "../services/statusService.js";
import { startSocketServer, once, never } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

let server;
let alice; // owns the status
let bob; // follows alice
let carol; // does not follow alice
let status;

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
  await Follow.create({ follower: bob.id, following: alice.id });
  const visibleUntil = new Date(Date.now() + 60 * 60 * 1000);
  status = await Status.create({
    user: alice.id,
    type: "text",
    content: "hello world",
    visibleUntil,
    expiresAt: new Date(visibleUntil.getTime() + 60 * 60 * 1000),
  });
});

const call = (method, user, path, body) => {
  const req = request(app)
    [method](`/api/v1/status${path}`)
    .set(bearer(user.token));
  return body ? req.send(body) : req;
};
const matches = (schema, body) =>
  expect(schema.safeParse(body).error?.issues ?? []).toEqual([]);

describe("liking", () => {
  it("counts one like per user, and repeating it changes nothing", async () => {
    const first = await call("put", bob, `/${status.id}/like`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ liked: true, likeCount: 1 });
    matches(R.LikeState, first.body);

    const again = await call("put", bob, `/${status.id}/like`);
    expect(again.body).toEqual({ liked: true, likeCount: 1 });
    expect(await StatusLike.countDocuments()).toBe(1);

    const owner = await call("put", alice, `/${status.id}/like`);
    expect(owner.body.likeCount).toBe(2);
  });

  it("stays at one like when the same user likes at once", async () => {
    await StatusLike.init();
    await Promise.all(
      Array.from({ length: 5 }, () => call("put", bob, `/${status.id}/like`))
    );
    expect(await StatusLike.countDocuments()).toBe(1);
    expect((await Status.findById(status.id)).likeCount).toBe(1);
  });

  it("can be taken back, and taking back twice is harmless", async () => {
    await call("put", bob, `/${status.id}/like`);
    const removed = await call("delete", bob, `/${status.id}/like`);
    expect(removed.body).toEqual({ liked: false, likeCount: 0 });
    const again = await call("delete", bob, `/${status.id}/like`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ liked: false, likeCount: 0 });
    expect(await StatusLike.countDocuments()).toBe(0);
  });

  it("is refused for people who cannot see the status", async () => {
    const res = await call("put", carol, `/${status.id}/like`);
    expect(res.status).toBe(404);
    expect(await StatusLike.countDocuments()).toBe(0);
    expect((await call("delete", carol, `/${status.id}/like`)).status).toBe(
      404
    );
  });

  it("answers 404 for unknown and expired statuses and 400 for bad ids", async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    expect((await call("put", bob, `/${missing}/like`)).status).toBe(404);
    expect((await call("put", bob, "/nope/like")).status).toBe(400);

    await Status.updateOne(
      { _id: status.id },
      { visibleUntil: new Date(Date.now() - 1000) }
    );
    expect((await call("put", bob, `/${status.id}/like`)).status).toBe(404);
  });

  it("notifies the owner once, live, and not for their own like", async () => {
    const onAlice = await server.client(alice);
    const pushed = once(onAlice, "receive-notification");
    await call("put", bob, `/${status.id}/like`);
    expect(await pushed).toMatchObject({
      type: "like",
      statusId: status.id,
      fromUser: { _id: bob.id },
    });

    // Unlike and like again: still one notification, nothing new pushed.
    await call("delete", bob, `/${status.id}/like`);
    expect(await Notification.countDocuments({ type: "like" })).toBe(0);
    await call("put", bob, `/${status.id}/like`);
    await call("put", bob, `/${status.id}/like`);
    expect(await Notification.countDocuments({ type: "like" })).toBe(1);

    await call("put", alice, `/${status.id}/like`);
    expect(await Notification.countDocuments({ type: "like" })).toBe(1);
  });
});

describe("replies", () => {
  it("are saved, counted and listed oldest first with a cursor", async () => {
    for (const text of ["one", "two", "three"]) {
      const res = await call("post", bob, `/${status.id}/replies`, { text });
      expect(res.status).toBe(201);
      matches(R.StatusReply, res.body);
      expect(res.body.user).toMatchObject({ _id: bob.id });
    }
    await call("post", alice, `/${status.id}/replies`, { text: "thanks" });
    expect((await Status.findById(status.id)).replyCount).toBe(4);

    const first = await call("get", alice, `/${status.id}/replies?limit=3`);
    expect(first.status).toBe(200);
    expect(first.body.items.map((r) => r.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await call(
      "get",
      bob,
      `/${status.id}/replies?limit=3&cursor=${first.body.nextCursor}`
    );
    expect(second.body.items.map((r) => r.text)).toEqual(["thanks"]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("validate the text", async () => {
    for (const body of [
      {},
      { text: "" },
      { text: "   " },
      { text: "x".repeat(501) },
    ]) {
      const res = await call("post", bob, `/${status.id}/replies`, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(
      (
        await call("post", bob, `/${status.id}/replies`, {
          text: "x".repeat(500),
        })
      ).status
    ).toBe(201);
  });

  it("need access to the status, to write and to read", async () => {
    expect(
      (await call("post", carol, `/${status.id}/replies`, { text: "hi" }))
        .status
    ).toBe(404);
    expect((await call("get", carol, `/${status.id}/replies`)).status).toBe(
      404
    );
    expect(await StatusReply.countDocuments()).toBe(0);
  });

  it("notify the owner, live, but not for their own replies", async () => {
    const onAlice = await server.client(alice);
    const pushed = once(onAlice, "receive-notification");
    await call("post", bob, `/${status.id}/replies`, { text: "nice" });
    expect(await pushed).toMatchObject({ type: "reply", statusId: status.id });

    const quiet = never(onAlice, "receive-notification");
    await call("post", alice, `/${status.id}/replies`, { text: "thanks" });
    expect(await quiet).toBe(true);
    // Each reply is its own notification.
    await call("post", bob, `/${status.id}/replies`, { text: "again" });
    expect(await Notification.countDocuments({ type: "reply" })).toBe(2);
  });

  it("leave out replies of blocked accounts", async () => {
    await call("post", bob, `/${status.id}/replies`, { text: "from bob" });
    await call("post", alice, `/${status.id}/replies`, { text: "from alice" });
    await User.updateOne({ _id: bob.id }, { isBlocked: true });
    const res = await call("get", alice, `/${status.id}/replies`);
    expect(res.body.items.map((r) => r.text)).toEqual(["from alice"]);
  });
});

describe("views", () => {
  it("count each user once, and not the owner", async () => {
    await StatusView.init();
    await Promise.all([
      call("post", bob, `/${status.id}/view`),
      call("post", bob, `/${status.id}/view`),
    ]);
    const again = await call("post", bob, `/${status.id}/view`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ viewCount: 1 });
    matches(R.ViewCount, again.body);

    const owner = await call("post", alice, `/${status.id}/view`);
    expect(owner.body).toEqual({ viewCount: 1 });

    const other = await createUser();
    await Follow.create({ follower: other.id, following: alice.id });
    expect(
      (await call("post", other, `/${status.id}/view`)).body.viewCount
    ).toBe(2);
    expect(await StatusView.countDocuments()).toBe(2);
  });

  it("are refused for people who cannot see the status", async () => {
    expect((await call("post", carol, `/${status.id}/view`)).status).toBe(404);
    expect(await StatusView.countDocuments()).toBe(0);
  });
});

describe("counts on responses", () => {
  it("appear on the feed, with likedByMe", async () => {
    await call("put", bob, `/${status.id}/like`);
    await call("post", alice, `/${status.id}/replies`, { text: "hi" });
    await call("post", bob, `/${status.id}/view`);

    const forBob = await call("get", bob, "/feed");
    expect(forBob.status).toBe(200);
    const [item] = forBob.body.items;
    expect(item).toMatchObject({
      _id: status.id,
      likeCount: 1,
      replyCount: 1,
      viewCount: 1,
      likedByMe: true,
    });
    matches(R.StatusItem, item);

    const forAlice = await call("get", alice, "/feed");
    expect(forAlice.body.items[0]).toMatchObject({
      likeCount: 1,
      likedByMe: false,
    });
  });

  it("appear on a single status, and on a new one", async () => {
    await call("put", bob, `/${status.id}/like`);
    const one = await call("get", bob, `/${status.id}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ likeCount: 1, likedByMe: true });
    matches(R.StatusItem, one.body);
    expect((await call("get", carol, `/${status.id}`)).status).toBe(404);

    const created = await call("post", alice, "", {
      type: "text",
      content: "fresh",
    });
    expect(created.body.status).toMatchObject({
      likeCount: 0,
      replyCount: 0,
      viewCount: 0,
      likedByMe: false,
    });
  });

  it("show zero for statuses made before the counts existed", async () => {
    await Status.collection.updateOne(
      { _id: status._id },
      { $unset: { likeCount: 1, replyCount: 1, viewCount: 1 } }
    );
    const res = await call("get", alice, `/${status.id}`);
    expect(res.body).toMatchObject({
      likeCount: 0,
      replyCount: 0,
      viewCount: 0,
    });
    expect((await call("put", bob, `/${status.id}/like`)).body.likeCount).toBe(
      1
    );
  });
});

describe("blocked accounts", () => {
  it("have their statuses hidden from the feed and from direct access", async () => {
    await User.updateOne({ _id: alice.id }, { isBlocked: true });
    expect((await call("get", bob, "/feed")).body.items).toEqual([]);
    expect((await call("get", bob, `/${status.id}`)).status).toBe(404);
    expect((await call("put", bob, `/${status.id}/like`)).status).toBe(404);
    expect(
      (await call("post", bob, `/${status.id}/replies`, { text: "x" })).status
    ).toBe(404);
    expect((await call("post", bob, `/${status.id}/view`)).status).toBe(404);
  });

  it("cannot interact at all", async () => {
    await User.updateOne({ _id: bob.id }, { isBlocked: true });
    expect((await call("put", bob, `/${status.id}/like`)).status).toBe(403);
    expect(await StatusLike.countDocuments()).toBe(0);
  });
});

describe("deleting a status", () => {
  async function addActivity() {
    await call("put", bob, `/${status.id}/like`);
    await call("post", bob, `/${status.id}/replies`, { text: "hi" });
    await call("post", bob, `/${status.id}/view`);
  }
  const counts = async () => ({
    likes: await StatusLike.countDocuments(),
    replies: await StatusReply.countDocuments(),
    views: await StatusView.countDocuments(),
    notes: await Notification.countDocuments(),
    statuses: await Status.countDocuments(),
  });

  it("lets the owner delete it with its likes, replies, views and notifications", async () => {
    await addActivity();
    expect(await counts()).toEqual({
      likes: 1,
      replies: 1,
      views: 1,
      notes: 2,
      statuses: 1,
    });

    const res = await call("delete", alice, `/${status.id}`);
    expect(res.status).toBe(200);
    expect(await counts()).toEqual({
      likes: 0,
      replies: 0,
      views: 0,
      notes: 0,
      statuses: 0,
    });
    expect((await call("delete", alice, `/${status.id}`)).status).toBe(404);
  });

  it("is only for the owner", async () => {
    await addActivity();
    expect((await call("delete", bob, `/${status.id}`)).status).toBe(404);
    expect((await call("delete", carol, `/${status.id}`)).status).toBe(404);
    expect((await counts()).statuses).toBe(1);
  });

  it("also happens when an admin removes a reported status", async () => {
    await addActivity();
    const admin = await makeAdmin(await createUser());
    const res = await request(app)
      .delete(`/api/v1/admin/remove/status/${status.id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(await counts()).toEqual({
      likes: 0,
      replies: 0,
      views: 0,
      notes: 0,
      statuses: 0,
    });
  });

  it("is what removeStatus does, one status at a time", async () => {
    await addActivity();
    const other = await Status.create({
      user: alice.id,
      type: "text",
      content: "second",
      visibleUntil: status.visibleUntil,
      expiresAt: status.expiresAt,
    });
    await call("put", bob, `/${other.id}/like`);
    await removeStatus(await Status.findById(status.id));
    expect(await Status.countDocuments()).toBe(1);
    expect(await StatusLike.countDocuments()).toBe(1);
  });

  it("gives the likes, replies and views the same expiry as the status", async () => {
    await addActivity();
    for (const Model of [StatusLike, StatusReply, StatusView]) {
      const doc = await Model.findOne();
      expect(doc.expiresAt.getTime()).toBe(status.expiresAt.getTime());
    }
  });

  it("clears notifications of statuses that expired on their own", async () => {
    await addActivity();
    await Status.deleteOne({ _id: status._id }); // what the TTL index does
    expect(await removeNotificationsOfMissingStatuses()).toBe(2);
    expect(await Notification.countDocuments()).toBe(0);
    expect(await removeNotificationsOfMissingStatuses()).toBe(0);
  });
});

describe("feed", () => {
  it("still shows statuses of people you follow, and your own", async () => {
    const res = await call("get", bob, "/feed");
    expect(res.body.items.map((s) => s._id)).toEqual([status.id]);
    expect((await call("get", carol, "/feed")).body.items).toEqual([]);
  });
});
