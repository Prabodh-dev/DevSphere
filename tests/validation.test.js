import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import User from "../models/User.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

let alice;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
});

const register = (overrides) =>
  request(app)
    .post("/api/v1/auth/register")
    .send({
      username: "newuser",
      email: "newuser@example.test",
      password: "a-good-passw0rd",
      ...overrides,
    });

describe("registration rules", () => {
  it("accepts a valid account", async () => {
    expect((await register({})).status).toBe(201);
  });

  it.each([
    ["too short", "abc123"],
    ["no digit", "only-letters-here"],
    ["no letter", "1234567890123"],
    ["too long", "a1".repeat(40)],
  ])("rejects a password that is %s", async (_label, password) => {
    const res = await register({ password });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain("password");
  });

  it.each([
    ["too short", "ab"],
    ["too long", "x".repeat(31)],
    ["unusual characters", "bad name!"],
  ])("rejects a username that is %s", async (_label, username) => {
    const res = await register({ username });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain("username");
  });

  it("rejects values that are not plain strings", async () => {
    for (const value of [{ $ne: null }, ["a"], 5, true, null]) {
      expect((await register({ username: value })).status).toBe(400);
      expect((await register({ email: value })).status).toBe(400);
      expect((await register({ password: value })).status).toBe(400);
    }
  });

  it("rejects bodies that are not objects", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(["not", "an", "object"]);
    expect(res.status).toBe(400);
  });
});

describe("profile fields", () => {
  const save = (body) =>
    request(app).post("/api/v1/profile").set(bearer(alice.token)).send(body);

  it("accepts http(s) links", async () => {
    const res = await save({
      github: "https://example.test/me",
      website: "http://example.test",
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ["not a url", "just some text"],
    ["a script url", "javascript:void(0)"],
    ["another protocol", "ftp://example.test/file"],
    ["too long", "https://example.test/" + "a".repeat(250)],
  ])("rejects a link that is %s", async (_label, value) => {
    expect((await save({ github: value })).status).toBe(400);
    expect((await save({ website: value })).status).toBe(400);
  });

  it("limits tag count and length", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect((await save({ tags: many })).status).toBe(400);
    expect((await save({ tags: ["x".repeat(31)] })).status).toBe(400);
    expect((await save({ tags: [{ $ne: 1 }] })).status).toBe(400);
  });
});

describe("other field limits", () => {
  it("limits group names and member lists", async () => {
    const others = [await createUser(), await createUser()];
    const create = (body) =>
      request(app)
        .post("/api/v1/group/create")
        .set(bearer(alice.token))
        .send(body);

    expect(
      (
        await create({
          chatName: "x".repeat(101),
          members: others.map((u) => u.id),
        })
      ).status
    ).toBe(400);

    const tooMany = Array.from({ length: 101 }, () =>
      new mongoose.Types.ObjectId().toString()
    );
    expect((await create({ chatName: "ok", members: tooMany })).status).toBe(
      400
    );

    expect(
      (await create({ chatName: "ok", members: [{ $ne: null }, "x"] })).status
    ).toBe(400);
  });

  it("limits tag updates", async () => {
    const res = await request(app)
      .patch("/api/v1/users/me/tags")
      .set(bearer(alice.token))
      .send({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) });
    expect(res.status).toBe(400);
  });
});

describe("query filter sanitising", () => {
  it("does not treat operator-shaped values as operators", async () => {
    await expect(
      User.find({ email: { $ne: "nobody@example.test" } }).exec()
    ).rejects.toThrow();
  });

  it("still allows operators that the code marks as trusted", async () => {
    const found = await User.find({
      email: mongoose.trusted({ $ne: "nobody@example.test" }),
    }).exec();
    expect(found.length).toBeGreaterThan(0);
  });
});
