import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import User from "../models/User.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import LiveCode from "../models/LiveCode.js";
import UserProfile from "../models/UserProfile.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

const id = () => new mongoose.Types.ObjectId();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearTestDb);

const invalid = async (doc) => {
  const error = await doc.validate().then(
    () => null,
    (err) => err
  );
  expect(error?.name).toBe("ValidationError");
  return Object.keys(error.errors);
};

const user = (overrides = {}) =>
  new User({
    username: "someone",
    email: "someone@example.test",
    password: "hash",
    ...overrides,
  });

describe("User", () => {
  it("has created and updated timestamps", async () => {
    const saved = await user().save();
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBeInstanceOf(Date);

    const before = saved.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 15));
    saved.tags = ["go"];
    await saved.save();
    expect(saved.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it("trims and lower-cases the email", () => {
    expect(user({ email: "  Some@Example.TEST " }).email).toBe(
      "some@example.test"
    );
  });

  it("limits usernames, emails, tags and avatar keys", async () => {
    expect(await invalid(user({ username: "ab" }))).toContain("username");
    expect(await invalid(user({ username: "x".repeat(31) }))).toContain(
      "username"
    );
    expect(
      await invalid(user({ email: "a".repeat(250) + "@x.test" }))
    ).toContain("email");
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(await invalid(user({ tags: many }))).toContain("tags");
    expect(await invalid(user({ tags: ["x".repeat(31)] }))).toContain("tags");
    expect(await invalid(user({ avatarKey: "k".repeat(301) }))).toContain(
      "avatarKey"
    );
  });
});

describe("Message", () => {
  const message = (overrides = {}) =>
    new Message({ chat: id(), sender: id(), text: "hi", ...overrides });

  it("needs a chat and a sender", async () => {
    expect(await invalid(message({ chat: undefined }))).toContain("chat");
    expect(await invalid(message({ sender: undefined }))).toContain("sender");
  });

  it("needs text, or code for code messages", async () => {
    expect(await invalid(message({ text: undefined }))).toContain("text");
    expect(await invalid(message({ type: "code", text: undefined }))).toContain(
      "code.content"
    );
    await message({
      type: "code",
      text: undefined,
      code: { language: "js", content: "1" },
    }).validate();
  });

  it("limits sizes and types", async () => {
    expect(await invalid(message({ text: "x".repeat(5001) }))).toContain(
      "text"
    );
    expect(await invalid(message({ type: "video" }))).toContain("type");
    expect(
      await invalid(
        message({
          type: "code",
          code: { language: "x".repeat(51), content: "1" },
        })
      )
    ).toContain("code.language");
  });
});

describe("other models", () => {
  it("limit chat names", async () => {
    expect(await invalid(new Chat({ chatName: "x".repeat(101) }))).toContain(
      "chatName"
    );
  });

  it("limit notification content", async () => {
    const base = { user: id(), type: "follow" };
    expect(
      await invalid(new Notification({ ...base, content: "x".repeat(501) }))
    ).toContain("content");
  });

  it("limit report reasons", async () => {
    const base = { reportedBy: id(), targetType: "message", targetId: id() };
    expect(
      await invalid(new Report({ ...base, reason: "x".repeat(1001) }))
    ).toContain("reason");
    expect(
      await invalid(new Report({ ...base, reason: "x", targetType: "post" }))
    ).toContain("targetType");
  });

  it("limit status text", async () => {
    const base = { user: id(), type: "text", expiresAt: new Date() };
    expect(
      await invalid(new Status({ ...base, content: "x".repeat(1001) }))
    ).toContain("content");
  });

  it("limit live code metadata", async () => {
    const base = { chatId: id(), code: "x" };
    expect(
      await invalid(new LiveCode({ ...base, language: "x".repeat(51) }))
    ).toContain("language");
    expect(
      await invalid(new LiveCode({ ...base, fileName: "x".repeat(101) }))
    ).toContain("fileName");
  });

  it("limit profile fields", async () => {
    const base = { user: id() };
    expect(
      await invalid(new UserProfile({ ...base, bio: "x".repeat(301) }))
    ).toContain("bio");
    expect(
      await invalid(new UserProfile({ ...base, github: "x".repeat(201) }))
    ).toContain("github");
  });
});
