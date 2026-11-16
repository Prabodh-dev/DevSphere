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
  uploadToS3: vi.fn().mockResolvedValue("https://example.test/avatars/me.png"),
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

const save = () => request(app).post("/api/profile").set(bearer(alice.token));

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

  it("stores the avatar on the profile and on the user record", async () => {
    const res = await save()
      .field("bio", "with avatar")
      .attach("avatar", Buffer.from("fake-image"), "me.png");
    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe("https://example.test/avatars/me.png");

    const user = await User.findById(alice.id);
    expect(user.avatar).toBe("https://example.test/avatars/me.png");
  });

  it("rejects a bio that is too long", async () => {
    const res = await save().send({ bio: "x".repeat(301) });
    expect(res.status).toBe(400);
  });

  it("returns my profile, or 404 before one exists", async () => {
    const before = await request(app)
      .get("/api/profile/me")
      .set(bearer(alice.token));
    expect(before.status).toBe(404);

    await save().send({ bio: "hi" });
    const after = await request(app)
      .get("/api/profile/me")
      .set(bearer(alice.token));
    expect(after.status).toBe(200);
    expect(after.body.bio).toBe("hi");
  });

  it("returns a profile by user id with 400/404 for bad or missing ids", async () => {
    await save().send({ bio: "hi" });

    const ok = await request(app).get(`/api/profile/${alice.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe(alice.username);

    const bad = await request(app).get("/api/profile/not-an-id");
    expect(bad.status).toBe(400);

    const missing = await request(app).get(
      `/api/profile/${new mongoose.Types.ObjectId()}`
    );
    expect(missing.status).toBe(404);
  });
});
