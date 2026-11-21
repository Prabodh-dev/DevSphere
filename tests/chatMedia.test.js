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
import { png, jpeg, pdf, zip, html } from "./helpers/files.js";
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
const { default: Chat } = await import("../models/Chat.js");
const { default: Message } = await import("../models/Message.js");
const { default: User } = await import("../models/User.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser, makeAdmin, bearer } = await import("./helpers/users.js");
const { withEnv } = await import("./helpers/config.js");
const { cleanFileName } = await import("../services/chatService.js");
const { startSocketServer, once, never, sleep } =
  await import("./helpers/socket.js");

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
  send.mockReset();
  send.mockResolvedValue({});
  process.env.AVATAR_BUCKET = "example-bucket";
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  chat = await Chat.create({ members: [alice.id, bob.id] });
});

const puts = () =>
  sentCommands(send).filter((c) => c.name === "PutObjectCommand");
const deletes = () =>
  sentCommands(send).filter((c) => c.name === "DeleteObjectCommand");

const sendFile = (user, buffer, options = {}, chatId = chat.id) => {
  const { filename = "picture.png", contentType = "image/png" } = options;
  return request(app)
    .post("/api/v1/chat/media")
    .set(bearer(user.token))
    .field("chatId", chatId)
    .attach("file", buffer, { filename, contentType });
};

describe("POST /api/v1/chat/media", () => {
  it("stores an image under a generated key and returns a signed link", async () => {
    const res = await sendFile(alice, png(2048), { filename: "diagram.png" });

    expect(res.status).toBe(201);
    expect(puts()).toHaveLength(1);
    const [put] = puts();
    expect(put.Bucket).toBe("example-bucket");
    expect(put.Key).toMatch(/^chat\/[0-9a-f-]{36}\.png$/);
    expect(put.ContentType).toBe("image/png");

    expect(res.body).toMatchObject({
      type: "media",
      sender: { _id: alice.id },
      media: {
        kind: "image",
        mimeType: "image/png",
        size: 2048,
        fileName: "diagram.png",
        url: `https://signed.example.test/${put.Key}?expires=300`,
      },
    });
    // The response matches the documented shape.
    const R = await import("../schemas/responses.js");
    expect(R.Message.safeParse(res.body).error?.issues ?? []).toEqual([]);
    // The storage key is not a field of the response.
    expect(res.body.media.key).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/"key"/);

    const stored = await Message.findById(res.body._id);
    expect(stored.media.key).toBe(put.Key);
    expect(stored.text).toBeUndefined();
  });

  it("sends PDF and ZIP files too, and shows a short preview in the chat list", async () => {
    const image = await sendFile(alice, jpeg(), {
      filename: "a.jpg",
      contentType: "image/jpeg",
    });
    expect(image.status).toBe(201);
    const list = await request(app).get("/api/v1/chat").set(bearer(bob.token));
    expect(list.body.items[0].latestMessage.preview).toBe("[image]");

    for (const [buffer, filename, contentType] of [
      [pdf(), "notes.pdf", "application/pdf"],
      [zip(), "src.zip", "application/zip"],
    ]) {
      const res = await sendFile(alice, buffer, { filename, contentType });
      expect(res.status).toBe(201);
      expect(res.body.media.kind).toBe("file");
    }
    const after = await request(app).get("/api/v1/chat").set(bearer(bob.token));
    expect(after.body.items[0].latestMessage.preview).toBe("[file]");
    expect((await Chat.findById(chat.id)).latestMessage).toBeTruthy();
  });

  it("lists media messages with signed links and no keys", async () => {
    await sendFile(alice, png());
    const res = await request(app)
      .get(`/api/v1/chat/message/${chat.id}`)
      .set(bearer(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.items[0].media.url).toMatch(/^https:\/\/signed\./);
    expect(JSON.stringify(res.body)).not.toMatch(/"key"/);
  });

  it("works in groups", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
    const res = await sendFile(carol, png(), {}, group.id);
    expect(res.status).toBe(201);
  });

  it("is delivered to members through the message service, and to nobody else", async () => {
    const onBob = await server.client(bob);
    const onCarol = await server.client(carol);
    const toBob = once(onBob, "receive-message");
    const leaked = never(onCarol, "receive-message");

    const res = await sendFile(alice, png(), { filename: "live.png" });
    const message = await toBob;
    expect(message._id).toBe(res.body._id);
    expect(message.media).toMatchObject({
      kind: "image",
      fileName: "live.png",
    });
    expect(message.media.url).toMatch(/^https:\/\/signed\./);
    expect(message.media.key).toBeUndefined();
    expect(JSON.stringify(message)).not.toMatch(/"key"/);
    expect(await leaked).toBe(true);
  });

  it("is not delivered to a blocked member", async () => {
    const onBob = await server.client(bob);
    await User.updateOne({ _id: bob.id }, { isBlocked: true });
    const silent = never(onBob, "receive-message");
    const res = await sendFile(alice, png());
    expect(res.status).toBe(201);
    expect(await silent).toBe(true);
  });

  it("is not delivered to someone removed from the group", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
    app.set("io", server.io);
    const onCarol = await server.client(carol);
    onCarol.emit("join-chat", group.id);
    await sleep(150);
    const removed = await request(app)
      .patch("/api/v1/group/remove")
      .set(bearer(alice.token))
      .send({ chatId: group.id, userId: carol.id });
    expect(removed.status).toBe(200);
    await sleep(100);

    const silent = never(onCarol, "receive-message");
    await sendFile(alice, png(), {}, group.id);
    expect(await silent).toBe(true);
  });

  it("is refused for non-members before anything is stored", async () => {
    const res = await sendFile(carol, png());
    expect(res.status).toBe(403);
    expect(puts()).toHaveLength(0);
    expect(await Message.countDocuments()).toBe(0);

    const missing = await sendFile(
      alice,
      png(),
      {},
      "665f1c2a9b1e8a0012a4c0aa"
    );
    expect(missing.status).toBe(404);
    expect(puts()).toHaveLength(0);
  });

  it("checks the bytes of the file, not the type the client names", async () => {
    const fake = await sendFile(alice, html(), {
      filename: "x.png",
      contentType: "image/png",
    });
    expect(fake.status).toBe(400);
    const pretend = await sendFile(alice, png(), {
      filename: "x.pdf",
      contentType: "application/pdf",
    });
    expect(pretend.status).toBe(400);
    expect(puts()).toHaveLength(0);
    expect(await Message.countDocuments()).toBe(0);
  });

  it("refuses types that are not on the list", async () => {
    for (const [filename, contentType] of [
      ["page.html", "text/html"],
      ["logo.svg", "image/svg+xml"],
      ["run.exe", "application/octet-stream"],
      ["clip.mp4", "video/mp4"],
    ]) {
      const res = await sendFile(alice, html(), { filename, contentType });
      expect(res.status, contentType).toBe(415);
    }
    expect(puts()).toHaveLength(0);
  });

  it("needs a file and a valid chat id", async () => {
    const none = await request(app)
      .post("/api/v1/chat/media")
      .set(bearer(alice.token))
      .field("chatId", chat.id);
    expect(none.status).toBe(400);
    const bad = await sendFile(alice, png(), {}, "nope");
    expect(bad.status).toBe(400);
  });

  it("applies a size limit to each kind of file", async () => {
    await withEnv(
      { CHAT_IMAGE_MAX_MB: "1", CHAT_FILE_MAX_MB: "3" },
      async () => {
        const MB = 1024 * 1024;
        const bigImage = await sendFile(alice, png(MB + 1));
        expect(bigImage.status).toBe(413);
        expect(bigImage.body.error.code).toBe("PAYLOAD_TOO_LARGE");

        const okImage = await sendFile(alice, png(MB - 100));
        expect(okImage.status).toBe(201);

        // A file may be larger than an image may be.
        const okPdf = await sendFile(alice, pdf(2 * MB), {
          filename: "a.pdf",
          contentType: "application/pdf",
        });
        expect(okPdf.status).toBe(201);

        const bigPdf = await sendFile(alice, pdf(3 * MB + 1), {
          filename: "b.pdf",
          contentType: "application/pdf",
        });
        expect(bigPdf.status).toBe(413);
      }
    );
    expect(puts()).toHaveLength(2);
  });

  it("answers 503 UPLOADS_NOT_CONFIGURED when storage is not set up", async () => {
    await withEnv({ AVATAR_BUCKET: "" }, async () => {
      const res = await sendFile(alice, png());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("UPLOADS_NOT_CONFIGURED");
    });
    expect(await Message.countDocuments()).toBe(0);

    // Text messages keep working.
    const text = await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({ chatId: chat.id, text: "still fine" });
    expect(text.status).toBe(201);
  });

  it("keeps the client's file name out of the key and cleans it for display", async () => {
    const res = await sendFile(alice, png(), {
      filename: "../../etc/passwd<1>.png",
    });
    expect(res.status).toBe(201);
    expect(res.body.media.fileName).toBe("passwd1.png");
    expect(puts()[0].Key).not.toContain("passwd");

    const long = await sendFile(alice, png(), {
      filename: `${"a".repeat(300)}.png`,
    });
    expect(long.body.media.fileName.length).toBeLessThanOrEqual(120);
    expect(long.body.media.fileName.endsWith(".png")).toBe(true);
  });

  it("cleans file names", () => {
    expect(cleanFileName("a\u0001b\u007f.txt")).toBe("ab.txt");
    expect(cleanFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(cleanFileName("..")).toBe("file");
    expect(cleanFileName("")).toBe("file");
    expect(cleanFileName(undefined)).toBe("file");
    // UTF-8 names arrive as latin1 text.
    const utf8 = Buffer.from("café.png", "utf8").toString("latin1");
    expect(cleanFileName(utf8)).toBe("café.png");
  });

  it("removes the stored file when the message cannot be saved", async () => {
    const spy = vi
      .spyOn(Message, "create")
      .mockRejectedValueOnce(new Error("database down"));
    try {
      const res = await sendFile(alice, png());
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(puts()).toHaveLength(1);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].Key).toBe(puts()[0].Key);
  });

  it("is not accepted as a JSON message type", async () => {
    const res = await request(app)
      .post("/api/v1/chat/message")
      .set(bearer(alice.token))
      .send({ chatId: chat.id, type: "media", text: "x" });
    expect(res.status).toBe(400);
  });

  it("deletes the stored file when an admin removes the message", async () => {
    const sent = await sendFile(alice, png());
    const admin = await makeAdmin(await createUser());
    const res = await request(app)
      .delete(`/api/v1/admin/remove/message/${sent.body._id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(deletes().map((d) => d.Key)).toEqual([puts()[0].Key]);
  });
});
