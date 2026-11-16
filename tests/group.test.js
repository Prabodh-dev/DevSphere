import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

const missingId = () => new mongoose.Types.ObjectId().toString();

let alice;
let bob;
let carol;
let dave;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  dave = await createUser();
});

const call = (method, path, user, body) =>
  request(app)[method](path).set(bearer(user.token)).send(body);

describe("POST /api/group/create", () => {
  it("creates a group with the creator as admin and member", async () => {
    const res = await call("post", "/api/group/create", alice, {
      chatName: "team",
      members: [bob.id, carol.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.isGroupChat).toBe(true);
    expect(res.body.members).toHaveLength(3);
    expect(res.body.admins).toEqual([alice.id]);
  });

  it("does not add the creator or duplicates twice", async () => {
    const res = await call("post", "/api/group/create", alice, {
      chatName: "team",
      members: [bob.id, bob.id, carol.id, alice.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.members).toHaveLength(3);
  });

  it.each([
    ["no name", { members: [] }],
    ["members not an array", { chatName: "x", members: "abcd" }],
    [
      "fewer than two other members",
      { chatName: "x", members: ["PLACEHOLDER"] },
    ],
    ["invalid ids", { chatName: "x", members: ["a", "b"] }],
  ])("returns 400 for %s", async (_label, body) => {
    if (body.members?.[0] === "PLACEHOLDER") body.members = [bob.id];
    const res = await call("post", "/api/group/create", alice, body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(["message"]);
  });

  it("returns 400 when a member does not exist", async () => {
    const res = await call("post", "/api/group/create", alice, {
      chatName: "x",
      members: [bob.id, missingId()],
    });
    expect(res.status).toBe(400);
  });
});

describe("group management", () => {
  let group;

  beforeEach(async () => {
    group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
  });

  it("lets an admin add a member", async () => {
    const res = await call("patch", "/api/group/add", alice, {
      chatId: group.id,
      userId: dave.id,
    });
    expect(res.status).toBe(200);
    const saved = await Chat.findById(group.id);
    expect(saved.members.map(String)).toContain(dave.id);
  });

  it("refuses non-admins", async () => {
    const res = await call("patch", "/api/group/add", bob, {
      chatId: group.id,
      userId: dave.id,
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown group instead of a server error", async () => {
    for (const [path, body] of [
      ["/api/group/add", { userId: dave.id }],
      ["/api/group/remove", { userId: bob.id }],
      ["/api/group/rename", { newName: "x" }],
    ]) {
      const res = await call("patch", path, alice, {
        chatId: missingId(),
        ...body,
      });
      expect(res.status).toBe(404);
    }
  });

  it("returns 404 when the user to add does not exist and 400 for bad ids", async () => {
    const unknown = await call("patch", "/api/group/add", alice, {
      chatId: group.id,
      userId: missingId(),
    });
    expect(unknown.status).toBe(404);

    const bad = await call("patch", "/api/group/add", alice, {
      chatId: "bad",
      userId: dave.id,
    });
    expect(bad.status).toBe(400);
  });

  it("returns 400 when the user is already a member", async () => {
    const res = await call("patch", "/api/group/add", alice, {
      chatId: group.id,
      userId: bob.id,
    });
    expect(res.status).toBe(400);
  });

  it("removes a member", async () => {
    const res = await call("patch", "/api/group/remove", alice, {
      chatId: group.id,
      userId: bob.id,
    });
    expect(res.status).toBe(200);
    const saved = await Chat.findById(group.id);
    expect(saved.members.map(String)).not.toContain(bob.id);
  });

  it("will not remove the only admin", async () => {
    const res = await call("patch", "/api/group/remove", alice, {
      chatId: group.id,
      userId: alice.id,
    });
    expect(res.status).toBe(400);
    const saved = await Chat.findById(group.id);
    expect(saved.admins.map(String)).toEqual([alice.id]);
  });

  it("allows removing an admin when another admin remains", async () => {
    await Chat.findByIdAndUpdate(group.id, { $push: { admins: bob.id } });
    const res = await call("patch", "/api/group/remove", alice, {
      chatId: group.id,
      userId: alice.id,
    });
    expect(res.status).toBe(200);
  });

  it("renames the group and validates the name", async () => {
    const ok = await call("patch", "/api/group/rename", alice, {
      chatId: group.id,
      newName: "renamed",
    });
    expect(ok.status).toBe(200);
    expect((await Chat.findById(group.id)).chatName).toBe("renamed");

    const bad = await call("patch", "/api/group/rename", alice, {
      chatId: group.id,
      newName: "",
    });
    expect(bad.status).toBe(400);
  });
});
