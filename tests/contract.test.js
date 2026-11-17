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
import { z } from "zod";

// Uploads are mocked so the status and profile responses can be checked too.
vi.mock("../utils/s3Utils.js", () => ({
  uploadMedia: vi.fn().mockResolvedValue("status/test-key.png"),
  getSignedMediaUrl: vi.fn(async (key) =>
    key ? `https://signed.example.test/${key}` : ""
  ),
  deleteMedia: vi.fn().mockResolvedValue(true),
}));

const { default: app } = await import("../app.js");
const R = await import("../schemas/responses.js");
const { default: Chat } = await import("../models/Chat.js");
const { default: LiveCode } = await import("../models/LiveCode.js");
const { default: Message } = await import("../models/Message.js");
const { connectTestDb, clearTestDb, disconnectTestDb } =
  await import("./helpers/db.js");
const { createUser, makeAdmin, loginAs, bearer, ORIGIN } =
  await import("./helpers/users.js");

// The documented response shapes must match what the API really sends.
const matches = (schema, body) => {
  const result = schema.safeParse(body);
  expect(
    result.error?.issues ?? [],
    JSON.stringify(body).slice(0, 300)
  ).toEqual([]);
};

let alice;
let bob;
let admin;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  admin = await makeAdmin(await createUser());
});

const as = (user) => ({
  get: (p) => request(app).get(p).set(bearer(user.token)),
  post: (p) => request(app).post(p).set(bearer(user.token)),
  patch: (p) => request(app).patch(p).set(bearer(user.token)),
  delete: (p) => request(app).delete(p).set(bearer(user.token)),
});

describe("auth responses", () => {
  it("match the documented shapes", async () => {
    const reg = await request(app).post("/api/v1/auth/register").send({
      username: "contract",
      email: "contract@example.test",
      password: "a-good-passw0rd",
    });
    matches(R.AuthResponse, reg.body);

    const login = await loginAs(alice);
    matches(R.AuthResponse, login.res.body);

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", ORIGIN)
      .set("Cookie", login.cookie);
    matches(R.TokenResponse, refreshed.body);

    const sessions = await as(alice).get("/api/v1/auth/sessions");
    matches(z.array(R.SessionInfo), sessions.body);
    matches(
      R.MessageResponse,
      (await as(alice).post("/api/v1/auth/logout-all")).body
    );
  });
});

describe("profile, users and follows", () => {
  it("match the documented shapes", async () => {
    const saved = await as(alice)
      .post("/api/v1/profile")
      .send({ bio: "hi", github: "https://example.test/a", tags: ["go"] });
    matches(R.Profile, saved.body);
    matches(R.Profile, (await as(alice).get("/api/v1/profile/me")).body);
    matches(
      R.Profile,
      (await request(app).get(`/api/v1/profile/${alice.id}`)).body
    );

    matches(
      R.MessageResponse,
      (await as(bob).post(`/api/v1/users/${alice.id}/follow`)).body
    );
    matches(
      R.page("p", R.PublicUser),
      (await as(bob).get(`/api/v1/users/${alice.id}/followers`)).body
    );
    matches(
      R.page("p", R.PublicUser),
      (await as(bob).get(`/api/v1/users/${bob.id}/following`)).body
    );
    matches(
      R.TagsResponse,
      (
        await as(bob)
          .patch("/api/v1/users/me/tags")
          .send({ tags: ["go"] })
      ).body
    );
    matches(
      R.page("p", R.TaggedUser),
      (await as(bob).get("/api/v1/users?tag=go")).body
    );
    matches(
      R.MessageResponse,
      (await as(bob).post(`/api/v1/users/${alice.id}/unfollow`)).body
    );
  });
});

describe("chat, groups and notifications", () => {
  it("match the documented shapes", async () => {
    const chat = await as(alice)
      .post("/api/v1/chat/access")
      .send({ userId: bob.id });
    matches(R.Chat, chat.body);

    const sent = await as(alice)
      .post("/api/v1/chat/message")
      .send({ chatId: chat.body._id, text: "hello" });
    matches(R.Message, sent.body);

    matches(
      R.page("p", R.ChatListItem),
      (await as(alice).get("/api/v1/chat")).body
    );
    matches(
      R.page("p", R.Message),
      (await as(bob).get(`/api/v1/chat/message/${chat.body._id}`)).body
    );

    const carol = await createUser();
    const group = await as(alice)
      .post("/api/v1/group/create")
      .send({ chatName: "team", members: [bob.id, carol.id] });
    matches(R.ChatListItem, group.body);

    const rename = await as(alice)
      .patch("/api/v1/group/rename")
      .send({ chatId: group.body._id, newName: "renamed" });
    matches(R.MessageResponse, rename.body);

    matches(
      R.page("p", R.NotificationItem),
      (await as(bob).get("/api/v1/notifications")).body
    );
    const notifications = (await as(bob).get("/api/v1/notifications")).body;
    expect(notifications.items.length).toBeGreaterThan(0);
  });

  it("describe live code, including no document", async () => {
    const chat = await Chat.create({ members: [alice.id, bob.id] });
    const empty = await as(alice).get(`/api/v1/live-code/${chat.id}`);
    matches(R.LiveCodeDoc, empty.body);
    expect(empty.body).toBeNull();

    await LiveCode.create({ chatId: chat.id, code: "x = 1" });
    matches(
      R.LiveCodeDoc,
      (await as(alice).get(`/api/v1/live-code/${chat.id}`)).body
    );
  });
});

describe("status, snippets, reports and admin", () => {
  it("match the documented shapes", async () => {
    const posted = await as(alice)
      .post("/api/v1/status")
      .send({ type: "text", content: "hi" });
    matches(R.StatusCreated, posted.body);
    matches(
      R.page("p", R.StatusItem),
      (await as(alice).get("/api/v1/status/feed")).body
    );

    matches(
      R.Highlighted,
      (
        await request(app)
          .post("/api/v1/snippets/highlight")
          .send({ code: "let a = 1;" })
      ).body
    );

    const message = await Message.create({
      chat: (await Chat.create({ members: [alice.id, bob.id] })).id,
      sender: bob.id,
      text: "rude",
    });
    const report = await as(alice)
      .post("/api/v1/report")
      .send({ targetType: "message", targetId: message.id, reason: "spam" });
    matches(R.ReportItem, report.body);

    matches(
      R.page("p", R.AdminUser),
      (await as(admin).get("/api/v1/admin/users")).body
    );
    matches(
      R.page("p", R.ReportItem),
      (await as(admin).get("/api/v1/admin/reports")).body
    );
    matches(
      R.MessageResponse,
      (await as(admin).delete(`/api/v1/admin/remove/message/${message.id}`))
        .body
    );
    matches(
      R.MessageResponse,
      (await as(admin).patch(`/api/v1/admin/block/${bob.id}`)).body
    );
  });

  it("use the documented error shape", async () => {
    const res = await request(app).get("/api/v1/chat");
    matches(R.ErrorResponse, res.body);
  });
});
