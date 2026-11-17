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
import { png, jpeg, mp4, html } from "./helpers/files.js";
import { sentCommands } from "./helpers/aws.js";

const send = vi.hoisted(() => vi.fn());
vi.mock("../utils/s3.js", () => ({
  getS3Client: () => ({ send }),
  isUploadConfigured: () => Boolean(process.env.AVATAR_BUCKET),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_client, command, options) =>
      `https://signed.example.test/${command.input.Key}?expires=${options.expiresIn}`
  ),
}));

const { default: app } = await import("../app.js");
const { default: User } = await import("../models/User.js");
const { default: Status } = await import("../models/Status.js");
const { cleanupExpiredStatusMedia } = await import("../utils/mediaCleanup.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser, bearer } = await import("./helpers/users.js");

let alice;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  send.mockReset();
  send.mockResolvedValue({});
  process.env.AVATAR_BUCKET = "example-bucket";
  alice = await createUser();
});

const uploads = () =>
  sentCommands(send).filter((c) => c.name === "PutObjectCommand");
const deletes = () =>
  sentCommands(send).filter((c) => c.name === "DeleteObjectCommand");

const avatar = (buffer, filename = "me.png", contentType = "image/png") =>
  request(app)
    .post("/api/v1/profile")
    .set(bearer(alice.token))
    .attach("avatar", buffer, { filename, contentType });

const postStatus = (fields, file) => {
  let req = request(app).post("/api/v1/status").set(bearer(alice.token));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  if (file) req = req.attach("media", file.buffer, file);
  return req;
};

describe("avatar uploads", () => {
  it("stores the file under a generated key and returns a signed link", async () => {
    const res = await avatar(png(), "../../my photo.png");
    expect(res.status).toBe(200);

    const [put] = uploads();
    expect(put.Key).toMatch(/^avatars\/[0-9a-f-]{36}\.png$/);
    expect(put.Key).not.toContain("photo");
    expect(put.ContentType).toBe("image/png");

    expect(res.body.avatar).toBe(
      `https://signed.example.test/${put.Key}?expires=300`
    );
    expect(res.body.avatarKey).toBeUndefined();
    expect((await User.findById(alice.id)).avatarKey).toBe(put.Key);
  });

  it("accepts other image formats", async () => {
    const res = await avatar(jpeg(), "x.jpg", "image/jpeg");
    expect(res.status).toBe(200);
    expect(uploads()[0].Key).toMatch(/\.jpg$/);
  });

  it.each([
    ["html", html(), "page.html", "text/html"],
    [
      "svg",
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      "a.svg",
      "image/svg+xml",
    ],
    ["video", mp4(), "clip.mp4", "video/mp4"],
  ])("rejects %s files", async (_label, buffer, filename, contentType) => {
    const res = await avatar(buffer, filename, contentType);
    expect(res.status).toBe(415);
    expect(uploads()).toHaveLength(0);
  });

  it("rejects a file whose content does not match its declared type", async () => {
    const res = await avatar(html(), "me.png", "image/png");
    expect(res.status).toBe(400);
    expect(uploads()).toHaveLength(0);
  });

  it("rejects files over the size limit", async () => {
    const res = await avatar(png(2 * 1024 * 1024 + 1024));
    expect(res.status).toBe(413);
    expect(uploads()).toHaveLength(0);
  });

  it("rejects more than one file", async () => {
    const res = await request(app)
      .post("/api/v1/profile")
      .set(bearer(alice.token))
      .attach("avatar", png(), { filename: "a.png", contentType: "image/png" })
      .attach("avatar", png(), { filename: "b.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("rejects files sent under another field name", async () => {
    const res = await request(app)
      .post("/api/v1/profile")
      .set(bearer(alice.token))
      .attach("other", png(), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("deletes the previous avatar when it is replaced", async () => {
    await avatar(png());
    const firstKey = uploads()[0].Key;

    await avatar(png());
    expect(deletes().map((d) => d.Key)).toEqual([firstKey]);
  });
});

describe("status media", () => {
  it("stores images and videos and returns signed links", async () => {
    const image = await postStatus(
      { type: "image" },
      { buffer: png(), filename: "a.png", contentType: "image/png" }
    );
    expect(image.status).toBe(201);
    expect(image.body.status.content).toMatch(
      /^https:\/\/signed\.example\.test\/status\/[0-9a-f-]{36}\.png\?expires=300$/
    );
    expect(image.body.status.mediaKey).toBeUndefined();

    const video = await postStatus(
      { type: "video" },
      { buffer: mp4(), filename: "a.mp4", contentType: "video/mp4" }
    );
    expect(video.status).toBe(201);
    expect(uploads().map((u) => u.Key)).toEqual([
      expect.stringMatching(/^status\/.*\.png$/),
      expect.stringMatching(/^status\/.*\.mp4$/),
    ]);
  });

  it("shows signed links in the feed too", async () => {
    await postStatus(
      { type: "image" },
      { buffer: png(), filename: "a.png", contentType: "image/png" }
    );
    const feed = await request(app)
      .get("/api/v1/status/feed")
      .set(bearer(alice.token));
    expect(feed.body.count).toBe(1);
    expect(feed.body.statuses[0].content).toContain("signed.example.test");
    expect(feed.body.statuses[0].user).toEqual({
      _id: alice.id,
      username: alice.username,
      avatar: "",
    });
  });

  it("rejects the wrong kind of file for the status type", async () => {
    const res = await postStatus(
      { type: "image" },
      { buffer: mp4(), filename: "a.mp4", contentType: "video/mp4" }
    );
    expect(res.status).toBe(400);
  });

  it("rejects unsupported and oversized files", async () => {
    const bad = await postStatus(
      { type: "image" },
      { buffer: html(), filename: "a.html", contentType: "text/html" }
    );
    expect(bad.status).toBe(415);

    const big = await postStatus(
      { type: "video" },
      {
        buffer: mp4(20 * 1024 * 1024 + 1024),
        filename: "a.mp4",
        contentType: "video/mp4",
      }
    );
    expect(big.status).toBe(413);
    expect(uploads()).toHaveLength(0);
  });

  it("keeps text statuses working", async () => {
    const res = await postStatus({ type: "text", content: "hello" });
    expect(res.status).toBe(201);
    expect(res.body.status.content).toBe("hello");
  });

  it("hides statuses after 24 hours but keeps the record a little longer", async () => {
    const res = await postStatus({ type: "text", content: "hello" });
    const saved = await Status.findById(res.body.status._id);
    expect(saved.expiresAt.getTime()).toBeGreaterThan(
      saved.visibleUntil.getTime()
    );

    await Status.updateOne(
      { _id: saved._id },
      { visibleUntil: new Date(Date.now() - 1000) }
    );
    const feed = await request(app)
      .get("/api/v1/status/feed")
      .set(bearer(alice.token));
    expect(feed.body.count).toBe(0);
  });

  it("still shows older statuses that only have an expiry date", async () => {
    await Status.collection.insertOne({
      user: (await User.findById(alice.id))._id,
      type: "text",
      content: "legacy",
      expiresAt: new Date(Date.now() + 60000),
    });
    const feed = await request(app)
      .get("/api/v1/status/feed")
      .set(bearer(alice.token));
    expect(feed.body.count).toBe(1);
  });
});

describe("cleanup of expired status media", () => {
  it("deletes stored files once a status is no longer visible", async () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 3600 * 1000);
    const old = await Status.create({
      user: alice.id,
      type: "image",
      mediaKey: "status/old.png",
      visibleUntil: past,
      expiresAt: future,
    });
    const current = await Status.create({
      user: alice.id,
      type: "image",
      mediaKey: "status/current.png",
      visibleUntil: future,
      expiresAt: future,
    });

    expect(await cleanupExpiredStatusMedia()).toBe(1);
    expect(deletes().map((d) => d.Key)).toEqual(["status/old.png"]);
    expect((await Status.findById(old.id)).mediaKey).toBeUndefined();
    expect((await Status.findById(current.id)).mediaKey).toBe(
      "status/current.png"
    );

    // Nothing left to do on the next run.
    send.mockClear();
    expect(await cleanupExpiredStatusMedia()).toBe(0);
    expect(deletes()).toHaveLength(0);
  });

  it("keeps the key when the delete fails so it is retried", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const status = await Status.create({
      user: alice.id,
      type: "image",
      mediaKey: "status/stuck.png",
      visibleUntil: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    send.mockRejectedValueOnce(new Error("denied"));

    expect(await cleanupExpiredStatusMedia()).toBe(0);
    expect((await Status.findById(status.id)).mediaKey).toBe(
      "status/stuck.png"
    );
    warn.mockRestore();
  });
});

describe("admin removal of a status", () => {
  it("deletes the stored file as well", async () => {
    const { makeAdmin } = await import("./helpers/users.js");
    const admin = await makeAdmin(await createUser());
    const status = await Status.create({
      user: alice.id,
      type: "image",
      mediaKey: "status/reported.png",
      visibleUntil: new Date(Date.now() + 3600 * 1000),
      expiresAt: new Date(Date.now() + 7200 * 1000),
    });

    const res = await request(app)
      .delete(`/api/v1/admin/remove/status/${status.id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(deletes().map((d) => d.Key)).toEqual(["status/reported.png"]);
  });
});
