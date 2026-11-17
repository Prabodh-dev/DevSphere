import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Follow from "../models/Follow.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

let alice;
let bob;
let carol;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  await Follow.init();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
});

const as = (user) => ({
  get: (p) => request(app).get(p).set(bearer(user.token)),
  post: (p) => request(app).post(p).set(bearer(user.token)),
});

describe("Follow model", () => {
  it("has a unique pair index and an index for listing followers", async () => {
    const indexes = await Follow.collection.indexes();
    const pair = indexes.find(
      (i) => i.key.follower === 1 && i.key.following === 1
    );
    expect(pair.unique).toBe(true);
    expect(
      indexes.some((i) => i.key.following === 1 && i.key.createdAt === -1)
    ).toBe(true);
  });

  it("refuses a duplicate pair and a self follow", async () => {
    await Follow.create({ follower: alice.id, following: bob.id });
    await expect(
      Follow.create({ follower: alice.id, following: bob.id })
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      Follow.create({ follower: alice.id, following: alice.id })
    ).rejects.toThrow();
  });

  it("is no longer stored on the user", async () => {
    const saved = await User.findById(alice.id).lean();
    expect(saved.followers).toBeUndefined();
    expect(saved.following).toBeUndefined();
    expect(User.schema.path("followers")).toBeUndefined();
    expect(User.schema.path("following")).toBeUndefined();
  });
});

describe("following and unfollowing", () => {
  it("creates one record and one notification", async () => {
    const res = await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    expect(res.status).toBe(200);

    expect(
      await Follow.countDocuments({ follower: alice.id, following: bob.id })
    ).toBe(1);
    expect(
      await Notification.countDocuments({ user: bob.id, type: "follow" })
    ).toBe(1);
  });

  it("rejects following yourself, unknown users and repeats", async () => {
    expect(
      (await as(alice).post(`/api/v1/users/${alice.id}/follow`)).status
    ).toBe(400);
    expect(
      (
        await as(alice).post(
          `/api/v1/users/${new mongoose.Types.ObjectId()}/follow`
        )
      ).status
    ).toBe(404);

    await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    const again = await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    expect(again.status).toBe(400);
    expect(await Follow.countDocuments()).toBe(1);
    // A rejected repeat does not notify again.
    expect(await Notification.countDocuments({ type: "follow" })).toBe(1);
  });

  it("lets only one of many simultaneous requests succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        as(alice).post(`/api/v1/users/${bob.id}/follow`)
      )
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(9);
    expect(await Follow.countDocuments()).toBe(1);
    expect(await Notification.countDocuments({ type: "follow" })).toBe(1);
  });

  it("unfollows, and repeating it is harmless", async () => {
    await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    const first = await as(alice).post(`/api/v1/users/${bob.id}/unfollow`);
    const second = await as(alice).post(`/api/v1/users/${bob.id}/unfollow`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await Follow.countDocuments()).toBe(0);

    const unknown = await as(alice).post(
      `/api/v1/users/${new mongoose.Types.ObjectId()}/unfollow`
    );
    expect(unknown.status).toBe(404);
  });

  it("can follow again after unfollowing", async () => {
    await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    await as(alice).post(`/api/v1/users/${bob.id}/unfollow`);
    expect(
      (await as(alice).post(`/api/v1/users/${bob.id}/follow`)).status
    ).toBe(200);
  });
});

describe("followers and following lists", () => {
  it("come from the follow records, newest first", async () => {
    await as(alice).post(`/api/v1/users/${carol.id}/follow`);
    await new Promise((r) => setTimeout(r, 20));
    await as(bob).post(`/api/v1/users/${carol.id}/follow`);

    const followers = await as(carol).get(
      `/api/v1/users/${carol.id}/followers`
    );
    expect(followers.body.map((u) => u.username)).toEqual([
      bob.username,
      alice.username,
    ]);
    expect(Object.keys(followers.body[0]).sort()).toEqual([
      "_id",
      "avatar",
      "username",
    ]);

    const following = await as(alice).get(
      `/api/v1/users/${alice.id}/following`
    );
    expect(following.body.map((u) => u.username)).toEqual([carol.username]);
  });

  it("support limit and skip", async () => {
    await as(alice).post(`/api/v1/users/${carol.id}/follow`);
    await new Promise((r) => setTimeout(r, 20));
    await as(bob).post(`/api/v1/users/${carol.id}/follow`);

    const first = await as(carol).get(
      `/api/v1/users/${carol.id}/followers?limit=1`
    );
    expect(first.body.map((u) => u.username)).toEqual([bob.username]);
    const next = await as(carol).get(
      `/api/v1/users/${carol.id}/followers?limit=1&skip=1`
    );
    expect(next.body.map((u) => u.username)).toEqual([alice.username]);

    expect(
      (await as(carol).get(`/api/v1/users/${carol.id}/followers?limit=1000`))
        .status
    ).toBe(400);
    expect(
      (await as(carol).get(`/api/v1/users/${carol.id}/followers?skip=-1`))
        .status
    ).toBe(400);
  });

  it("skip accounts that no longer exist", async () => {
    await as(alice).post(`/api/v1/users/${carol.id}/follow`);
    await User.deleteOne({ _id: alice.id });
    const res = await as(bob).get(`/api/v1/users/${carol.id}/followers`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("feed statuses of followed users", async () => {
    await as(alice).post(`/api/v1/users/${bob.id}/follow`);
    await as(bob)
      .post("/api/v1/status")
      .send({ type: "text", content: "from bob" });
    await as(carol)
      .post("/api/v1/status")
      .send({ type: "text", content: "from carol" });

    const feed = await as(alice).get("/api/v1/status/feed");
    expect(feed.body.statuses.map((s) => s.content)).toEqual(["from bob"]);
  });
});

describe("profile counts", () => {
  it("show follower and following counts", async () => {
    await as(bob).post(`/api/v1/users/${alice.id}/follow`);
    await as(carol).post(`/api/v1/users/${alice.id}/follow`);
    await as(alice).post(`/api/v1/users/${bob.id}/follow`);

    await request(app)
      .post("/api/v1/profile")
      .set(bearer(alice.token))
      .send({ bio: "hello" });

    const mine = await as(alice).get("/api/v1/profile/me");
    expect(mine.body.followersCount).toBe(2);
    expect(mine.body.followingCount).toBe(1);

    const other = await request(app).get(`/api/v1/profile/${alice.id}`);
    expect(other.body.followersCount).toBe(2);
    expect(other.body.followingCount).toBe(1);
  });
});
