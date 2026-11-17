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
  uploadMedia: vi.fn().mockResolvedValue("avatars/test-key.png"),
  getSignedMediaUrl: vi.fn(async (key) =>
    key ? `https://signed.example.test/${key}` : ""
  ),
  deleteMedia: vi.fn().mockResolvedValue(true),
}));

const { default: app } = await import("../app.js");
const { default: profileRoutes } = await import("../routes/profileRoutes.js");
const { default: User } = await import("../models/User.js");
const { default: UserProfile } = await import("../models/UserProfile.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser, bearer } = await import("./helpers/users.js");

let alice;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
});

const save = () =>
  request(app).post("/api/v1/profile").set(bearer(alice.token));

describe("profile routes", () => {
  it("registers POST / only once", () => {
    const postRoutes = profileRoutes.stack.filter(
      (layer) => layer.route?.path === "/" && layer.route.methods.post
    );
    expect(postRoutes).toHaveLength(1);
  });

  it("creates and updates a profile from JSON", async () => {
    const created = await save().send({
      bio: "hi",
      github: "https://example.test/gh",
      tags: ["node", "mongo"],
    });
    expect(created.status).toBe(200);
    expect(created.body.tags).toEqual(["node", "mongo"]);

    const updated = await save().send({ bio: "new bio" });
    expect(updated.status).toBe(200);
    expect(updated.body.bio).toBe("new bio");
    // Fields that were not sent are left alone.
    expect(updated.body.tags).toEqual(["node", "mongo"]);
    expect(await UserProfile.countDocuments()).toBe(1);
  });

  it("splits a comma separated tags field from multipart forms into separate tags", async () => {
    const res = await save()
      .field("bio", "hi")
      .field("tags", "node, mongo ,react");
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(["node", "mongo", "react"]);
  });

  it("accepts repeated tags fields from multipart forms", async () => {
    const res = await save().field("tags", "node").field("tags", "mongo");
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(["node", "mongo"]);
  });

  it("stores the avatar key and returns a link", async () => {
    const res = await save()
      .field("bio", "with avatar")
      .attach("avatar", Buffer.from("fake-image"), {
        filename: "me.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe(
      "https://signed.example.test/avatars/test-key.png"
    );
    expect(res.body.avatarKey).toBeUndefined();

    const user = await User.findById(alice.id);
    expect(user.avatarKey).toBe("avatars/test-key.png");
  });

  it("rejects a bio that is too long", async () => {
    const res = await save().send({ bio: "x".repeat(301) });
    expect(res.status).toBe(400);
  });

  it("returns my profile, or 404 before one exists", async () => {
    const before = await request(app)
      .get("/api/v1/profile/me")
      .set(bearer(alice.token));
    expect(before.status).toBe(404);

    await save().send({ bio: "hi" });
    const after = await request(app)
      .get("/api/v1/profile/me")
      .set(bearer(alice.token));
    expect(after.status).toBe(200);
    expect(after.body.bio).toBe("hi");
  });

  it("returns a profile by user id with 400/404 for bad or missing ids", async () => {
    await save().send({ bio: "hi" });

    const ok = await request(app).get(`/api/v1/profile/${alice.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe(alice.username);

    const bad = await request(app).get("/api/v1/profile/not-an-id");
    expect(bad.status).toBe(400);

    const missing = await request(app).get(
      `/api/v1/profile/${new mongoose.Types.ObjectId()}`
    );
    expect(missing.status).toBe(404);
  });
});

describe("single source of truth", () => {
  it("keeps tags and the avatar on the user, not on the profile", async () => {
    const res = await save()
      .field("bio", "hi")
      .field("tags", "node, mongo")
      .attach("avatar", Buffer.from("fake-image"), {
        filename: "me.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(200);

    const user = await User.findById(alice.id).lean();
    expect(user.tags).toEqual(["node", "mongo"]);
    expect(user.avatarKey).toBe("avatars/test-key.png");

    const stored = await UserProfile.findOne({ user: alice.id }).lean();
    expect(stored.tags).toBeUndefined();
    expect(stored.avatarKey).toBeUndefined();
    expect(stored.avatar).toBeUndefined();
    expect(stored.bio).toBe("hi");

    expect(UserProfile.schema.path("tags")).toBeUndefined();
    expect(UserProfile.schema.path("avatarKey")).toBeUndefined();
  });

  it("reads tags and avatar from the user", async () => {
    await save().send({ bio: "hi" });
    await User.updateOne(
      { _id: alice.id },
      { tags: ["go", "rust"], avatarKey: "avatars/other.png" }
    );

    const res = await request(app).get(`/api/v1/profile/${alice.id}`);
    expect(res.body.tags).toEqual(["go", "rust"]);
    expect(res.body.avatar).toBe(
      "https://signed.example.test/avatars/other.png"
    );
    expect(res.body.user).toMatchObject({ username: alice.username });
    expect(Object.keys(res.body)).not.toContain("avatarKey");
  });

  it("follows changes made through the tags endpoint and the search", async () => {
    await save().send({ bio: "hi", tags: ["node"] });

    await request(app)
      .patch("/api/v1/users/me/tags")
      .set(bearer(alice.token))
      .send({ tags: ["deno"] });

    const mine = await request(app)
      .get("/api/v1/profile/me")
      .set(bearer(alice.token));
    expect(mine.body.tags).toEqual(["deno"]);

    const found = await request(app)
      .get("/api/v1/users?tag=deno")
      .set(bearer(alice.token));
    expect(found.body.items.map((u) => u.username)).toEqual([alice.username]);
    const old = await request(app)
      .get("/api/v1/users?tag=node")
      .set(bearer(alice.token));
    expect(old.body.items).toEqual([]);
  });

  it("updates only the fields that were sent", async () => {
    await save().send({
      bio: "first",
      tags: ["node"],
      github: "https://example.test/a",
    });
    const res = await save().send({ website: "https://example.test/site" });
    expect(res.body.bio).toBe("first");
    expect(res.body.github).toBe("https://example.test/a");
    expect(res.body.website).toBe("https://example.test/site");
    expect(res.body.tags).toEqual(["node"]);
  });
});
