import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Snippet from "../models/Snippet.js";
import Report from "../models/Report.js";
import User from "../models/User.js";
import * as R from "../schemas/responses.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";

let alice;
let bob;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
});

const api = (method, path, user, body) => {
  const req = request(app)[method](`/api/v1/snippets${path}`);
  if (user) req.set(bearer(user.token));
  return body ? req.send(body) : req;
};
const make = (user, fields = {}) =>
  api("post", "", user, {
    title: "Debounce",
    code: "const debounce = () => {};",
    language: "javascript",
    ...fields,
  });
const matches = (schema, body) =>
  expect(schema.safeParse(body).error?.issues ?? []).toEqual([]);

describe("POST /api/v1/snippets", () => {
  it("saves a private snippet by default and returns it with its owner", async () => {
    const res = await make(alice, { tags: ["Utils", "utils", "JS"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Debounce",
      language: "javascript",
      visibility: "private",
      description: "",
      tags: ["utils", "js"],
      owner: { _id: alice.id, username: alice.username },
    });
    matches(R.Snippet, res.body);
    expect(res.body.owner.email).toBeUndefined();
    expect(res.body.owner.password).toBeUndefined();
  });

  it("defaults the language, and needs a login", async () => {
    const res = await api("post", "", alice, { title: "t", code: "x" });
    expect(res.body.language).toBe("plaintext");
    expect(
      (await api("post", "", null, { title: "t", code: "x" })).status
    ).toBe(401);
  });

  it("enforces the size limits", async () => {
    const bad = [
      { title: "" },
      { title: "x".repeat(101) },
      { code: "" },
      { code: "x".repeat(50001) },
      { description: "x".repeat(501) },
      { language: "x".repeat(51) },
      { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { tags: ["x".repeat(31)] },
      { visibility: "friends" },
    ];
    for (const fields of bad) {
      const res = await make(alice, fields);
      expect(res.status, JSON.stringify(fields).slice(0, 60)).toBe(400);
    }
    const max = await make(alice, {
      code: "x".repeat(50000),
      title: "x".repeat(100),
      description: "d".repeat(500),
    });
    expect(max.status).toBe(201);
    expect(await Snippet.countDocuments()).toBe(1);
  });
});

describe("reading", () => {
  it("lets anyone read a public snippet and only the owner a private one", async () => {
    const open = (await make(alice, { visibility: "public" })).body;
    const secret = (await make(alice, { title: "secret" })).body;

    expect((await api("get", `/${open._id}`, bob)).status).toBe(200);
    expect((await api("get", `/${secret._id}`, alice)).status).toBe(200);
    const hidden = await api("get", `/${secret._id}`, bob);
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain("secret");
  });

  it("answers 404 for unknown ids and 400 for malformed ones", async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    expect((await api("get", `/${missing}`, alice)).status).toBe(404);
    expect((await api("get", "/nope", alice)).status).toBe(400);
  });
});

describe("listing", () => {
  async function seed() {
    for (let i = 0; i < 5; i++) {
      await make(alice, {
        title: `public ${i}`,
        visibility: "public",
        language: i % 2 ? "python" : "javascript",
        tags: i < 3 ? ["algo"] : ["web"],
      });
    }
    await make(alice, { title: "private", tags: ["algo"] });
    await make(bob, {
      title: "bob public",
      visibility: "public",
      tags: ["algo"],
    });
  }

  it("lists your own snippets, public and private, newest first", async () => {
    await seed();
    const res = await api("get", "/mine", alice);
    expect(res.status).toBe(200);
    expect(res.body.items.map((s) => s.title)).toEqual([
      "private",
      "public 4",
      "public 3",
      "public 2",
      "public 1",
      "public 0",
    ]);
    expect(res.body.nextCursor).toBeNull();
    matches(R.page("MineCheck", R.Snippet), res.body);

    const onlyPrivate = await api("get", "/mine?visibility=private", alice);
    expect(onlyPrivate.body.items.map((s) => s.title)).toEqual(["private"]);
    const bobs = await api("get", "/mine", bob);
    expect(bobs.body.items.map((s) => s.title)).toEqual(["bob public"]);
  });

  it("pages with a cursor", async () => {
    await seed();
    const first = await api("get", "/mine?limit=4", alice);
    expect(first.body.items).toHaveLength(4);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await api(
      "get",
      `/mine?limit=4&cursor=${first.body.nextCursor}`,
      alice
    );
    expect(second.body.items.map((s) => s.title)).toEqual([
      "public 1",
      "public 0",
    ]);
    expect(second.body.nextCursor).toBeNull();
    expect((await api("get", "/mine?cursor=junk", alice)).status).toBe(400);
  });

  it("lists only the public snippets of a user", async () => {
    await seed();
    const res = await api("get", `/user/${alice.id}`, bob);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.items.every((s) => s.visibility === "public")).toBe(true);
    expect(res.body.items.some((s) => s.title === "private")).toBe(false);

    const byLanguage = await api(
      "get",
      `/user/${alice.id}?language=python`,
      bob
    );
    expect(byLanguage.body.items.map((s) => s.title)).toEqual([
      "public 3",
      "public 1",
    ]);
    const missing = new mongoose.Types.ObjectId().toString();
    expect((await api("get", `/user/${missing}`, bob)).status).toBe(404);
  });

  it("searches public snippets by tag and language, never showing private ones", async () => {
    await seed();
    const tag = await api("get", "/?tag=algo", bob);
    expect(tag.body.items.map((s) => s.title).sort()).toEqual(
      ["bob public", "public 0", "public 1", "public 2"].sort()
    );
    const upper = await api("get", "/?tag=ALGO", bob);
    expect(upper.body.items).toHaveLength(4);

    const both = await api("get", "/?tag=algo&language=python", bob);
    expect(both.body.items.map((s) => s.title)).toEqual(["public 1"]);
    const all = await api("get", "/", bob);
    expect(all.body.items).toHaveLength(6);
    expect(all.body.items.some((s) => s.visibility === "private")).toBe(false);
  });

  it("leaves out the public snippets of blocked accounts", async () => {
    await seed();
    await User.updateOne({ _id: alice.id }, { isBlocked: true });
    const res = await api("get", "/", bob);
    expect(res.body.items.map((s) => s.title)).toEqual(["bob public"]);
    expect((await api("get", `/user/${alice.id}`, bob)).status).toBe(404);
  });
});

describe("changing and deleting", () => {
  it("lets the owner update fields and visibility", async () => {
    const snippet = (await make(alice)).body;
    const res = await api("patch", `/${snippet._id}`, alice, {
      title: "Renamed",
      visibility: "public",
      tags: ["a", "A", "b"],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Renamed",
      visibility: "public",
      tags: ["a", "b"],
      code: snippet.code,
    });
    expect((await api("get", `/${snippet._id}`, bob)).status).toBe(200);

    await api("patch", `/${snippet._id}`, alice, { visibility: "private" });
    expect((await api("get", `/${snippet._id}`, bob)).status).toBe(404);
  });

  it("validates updates and refuses an empty one", async () => {
    const snippet = (await make(alice)).body;
    expect((await api("patch", `/${snippet._id}`, alice, {})).status).toBe(400);
    expect(
      (await api("patch", `/${snippet._id}`, alice, { code: "" })).status
    ).toBe(400);
    expect(
      (await api("patch", `/${snippet._id}`, alice, { visibility: "x" })).status
    ).toBe(400);
  });

  it("does not let anyone else change or delete it, even a public one", async () => {
    const snippet = (await make(alice, { visibility: "public" })).body;
    const patch = await api("patch", `/${snippet._id}`, bob, { title: "mine" });
    expect(patch.status).toBe(404);
    expect((await api("delete", `/${snippet._id}`, bob)).status).toBe(404);
    expect((await Snippet.findById(snippet._id)).title).toBe("Debounce");
  });

  it("deletes for the owner", async () => {
    const snippet = (await make(alice)).body;
    const res = await api("delete", `/${snippet._id}`, alice);
    expect(res.status).toBe(200);
    expect(await Snippet.countDocuments()).toBe(0);
    expect((await api("delete", `/${snippet._id}`, alice)).status).toBe(404);
  });
});

describe("reports and admin removal", () => {
  const report = (user, targetId) =>
    request(app)
      .post("/api/v1/report")
      .set(bearer(user.token))
      .send({ targetType: "snippet", targetId, reason: "spam" });

  it("lets people report a public snippet but not a private one", async () => {
    const open = (await make(alice, { visibility: "public" })).body;
    const secret = (await make(alice)).body;
    expect((await report(bob, open._id)).status).toBe(201);
    expect((await report(bob, open._id)).status).toBe(409);
    expect((await report(bob, secret._id)).status).toBe(404);
  });

  it("lets an admin remove a reported snippet and resolves the reports", async () => {
    const open = (await make(alice, { visibility: "public" })).body;
    await report(bob, open._id);
    const admin = await makeAdmin(await createUser());

    const res = await request(app)
      .delete(`/api/v1/admin/remove/snippet/${open._id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(await Snippet.countDocuments()).toBe(0);
    const stored = await Report.findOne({ targetId: open._id });
    expect(stored.status).toBe("resolved");

    const again = await request(app)
      .delete(`/api/v1/admin/remove/snippet/${open._id}`)
      .set(bearer(admin.token));
    expect(again.status).toBe(404);
    // Only admins can.
    const forbidden = await request(app)
      .delete(`/api/v1/admin/remove/snippet/${open._id}`)
      .set(bearer(bob.token));
    expect(forbidden.status).toBe(403);
  });
});

describe("the highlighter", () => {
  it("is still public", async () => {
    const res = await request(app)
      .post("/api/v1/snippets/highlight")
      .send({ code: "let a = 1;", language: "javascript" });
    expect(res.status).toBe(200);
    expect(res.body.highlighted).toContain("hljs");
  });
});
