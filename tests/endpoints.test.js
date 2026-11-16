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

vi.mock("../utils/s3Utils.js", () => ({
  uploadMedia: vi.fn().mockResolvedValue("status/test-key.png"),
  getSignedMediaUrl: vi.fn(async (key) =>
    key ? `https://signed.example.test/${key}` : ""
  ),
  deleteMedia: vi.fn().mockResolvedValue(true),
}));

const { default: app } = await import("../app.js");
const { default: User } = await import("../models/User.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser, bearer } = await import("./helpers/users.js");

const missingId = () => new mongoose.Types.ObjectId().toString();

let alice;
let bob;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
});

const as = (user) => ({
  get: (path) => request(app).get(path).set(bearer(user.token)),
  post: (path) => request(app).post(path).set(bearer(user.token)),
  patch: (path) => request(app).patch(path).set(bearer(user.token)),
  delete: (path) => request(app).delete(path).set(bearer(user.token)),
});

describe("users", () => {
  it("follows and unfollows", async () => {
    const follow = await as(alice).post(`/api/users/${bob.id}/follow`);
    expect(follow.status).toBe(200);

    const followers = await as(alice).get(`/api/users/${bob.id}/followers`);
    expect(followers.body.map((u) => u.username)).toEqual([alice.username]);
    // Only public fields are returned.
    expect(Object.keys(followers.body[0]).sort()).toEqual([
      "_id",
      "avatar",
      "username",
    ]);
    const following = await as(alice).get(`/api/users/${alice.id}/following`);
    expect(following.body.map((u) => u.username)).toEqual([bob.username]);

    const again = await as(alice).post(`/api/users/${bob.id}/follow`);
    expect(again.status).toBe(400);

    const unfollow = await as(alice).post(`/api/users/${bob.id}/unfollow`);
    expect(unfollow.status).toBe(200);
    expect((await User.findById(bob.id)).followers).toHaveLength(0);
  });

  it("returns 400 for invalid ids and 404 for unknown users", async () => {
    expect((await as(alice).post("/api/users/nope/follow")).status).toBe(400);
    expect((await as(alice).get("/api/users/nope/followers")).status).toBe(400);
    expect(
      (await as(alice).post(`/api/users/${missingId()}/follow`)).status
    ).toBe(404);
    expect(
      (await as(alice).get(`/api/users/${missingId()}/following`)).status
    ).toBe(404);
    expect((await as(alice).post(`/api/users/${alice.id}/follow`)).status).toBe(
      400
    );
  });

  it("updates tags and searches by tag", async () => {
    const res = await as(alice)
      .patch("/api/users/me/tags")
      .send({ tags: ["go"] });
    expect(res.status).toBe(200);

    const found = await as(bob).get("/api/users?tag=go");
    expect(found.body.map((u) => u.username)).toEqual([alice.username]);
    expect(Object.keys(found.body[0]).sort()).toEqual([
      "_id",
      "avatar",
      "tags",
      "username",
    ]);
  });

  it("validates tags and the search query", async () => {
    const patch = (body) => as(alice).patch("/api/users/me/tags").send(body);
    expect((await patch({ tags: "go" })).status).toBe(400);
    expect((await patch({ tags: [1, 2] })).status).toBe(400);
    expect((await as(bob).get("/api/users")).status).toBe(400);
    expect((await as(bob).get("/api/users?tag=a&tag=b")).status).toBe(400);
  });
});

describe("status", () => {
  const post = (user) => as(user).post("/api/status");

  it("posts a text status and shows it in the feed", async () => {
    const res = await post(alice).send({ type: "text", content: "hello" });
    expect(res.status).toBe(201);

    const feed = await as(alice).get("/api/status/feed");
    expect(feed.body.count).toBe(1);
    expect(feed.body.statuses[0].content).toBe("hello");
  });

  it("uploads image statuses", async () => {
    const res = await post(alice)
      .field("type", "image")
      .attach("media", Buffer.from("img"), {
        filename: "a.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(201);
    expect(res.body.status.content).toBe(
      "https://signed.example.test/status/test-key.png"
    );
  });

  it("validates type, content and files", async () => {
    expect((await post(alice).send({})).status).toBe(400);
    expect((await post(alice).send({ type: "gif", content: "x" })).status).toBe(
      400
    );
    expect((await post(alice).send({ type: "text" })).status).toBe(400);
    expect((await post(alice).send({ type: "text", content: {} })).status).toBe(
      400
    );
    expect((await post(alice).send({ type: "image" })).status).toBe(400);
  });
});

describe("notifications", () => {
  it("lists only the caller's notifications", async () => {
    const { default: Notification } = await import("../models/Notification.js");
    await Notification.create({
      user: bob.id,
      type: "follow",
      fromUser: alice.id,
    });
    await Notification.create({
      user: alice.id,
      type: "status",
      fromUser: bob.id,
    });

    const list = await as(bob).get("/api/notifications");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].type).toBe("follow");
  });

  it("cannot be created through the API", async () => {
    const res = await as(alice)
      .post("/api/notifications")
      .send({ user: bob.id, type: "follow", fromUser: alice.id });
    expect(res.status).toBe(404);

    const list = await as(bob).get("/api/notifications");
    expect(list.body).toHaveLength(0);
  });
});

describe("reports", () => {
  it("files a report and validates input", async () => {
    const report = (body) => as(alice).post("/api/report").send(body);
    const ok = await report({
      targetType: "message",
      targetId: missingId(),
      reason: "spam",
    });
    expect(ok.status).toBe(201);

    expect((await report({})).status).toBe(400);
    expect(
      (await report({ targetType: "x", targetId: missingId(), reason: "r" }))
        .status
    ).toBe(400);
    expect(
      (await report({ targetType: "user", targetId: "bad", reason: "r" }))
        .status
    ).toBe(400);
  });
});

describe("snippets", () => {
  it("highlights code and validates the body", async () => {
    const ok = await request(app)
      .post("/api/snippets/highlight")
      .send({ code: "const a = 1;", language: "javascript" });
    expect(ok.status).toBe(200);
    expect(ok.body.highlighted).toContain("hljs-");

    const unknown = await request(app)
      .post("/api/snippets/highlight")
      .send({ code: "hello", language: "not-a-language" });
    expect(unknown.status).toBe(200);

    const bad = await request(app).post("/api/snippets/highlight").send({});
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body)).toEqual(["message"]);
  });
});
