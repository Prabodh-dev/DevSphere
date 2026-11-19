import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Chat from "../models/Chat.js";
import LiveCode from "../models/LiveCode.js";
import {
  startSocketServer,
  once,
  never,
  sleep,
  emitAck,
  collect,
} from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { withEnv } from "./helpers/config.js";
import { createUser, bearer } from "./helpers/users.js";
import { flushLiveCode, resetLiveCode } from "../services/liveCodeService.js";

let server;
let other;
let alice;
let bob;
let carol;
let chat;

beforeAll(async () => {
  await connectTestDb();
  server = await startSocketServer();
  other = await startSocketServer();
  await sleep(300);
});

afterAll(async () => {
  await server.close();
  await other.close();
  await disconnectTestDb();
});

beforeEach(async () => {
  // REST handlers (group changes) push through this instance.
  app.set("io", server.io);
  resetLiveCode();
  await clearTestDb();
  alice = await createUser();
  bob = await createUser();
  carol = await createUser();
  chat = await Chat.create({ members: [alice.id, bob.id] });
});

const edit = (code, baseRevision, extra = {}) => ({
  chatId: chat.id,
  baseRevision,
  code,
  language: "python",
  fileName: "a.py",
  ...extra,
});

// Two members, both in the live room.
async function pair(from = server, to = server) {
  const a = await from.client(alice);
  const b = await to.client(bob);
  a.emit("join-live-code", { chatId: chat.id });
  b.emit("join-live-code", { chatId: chat.id });
  await sleep(200);
  return { a, b };
}

describe("accepting edits", () => {
  it("raises the revision and tells the other members, with the new revision", async () => {
    const { a, b } = await pair();
    const update = once(b, "code-update");
    const echoed = never(a, "code-update");

    const reply = await emitAck(a, "code-change", edit("x = 1", 0));
    expect(reply).toEqual({ ok: true, chatId: chat.id, revision: 1 });
    expect(await update).toEqual({
      chatId: chat.id,
      code: "x = 1",
      language: "python",
      fileName: "a.py",
      revision: 1,
      updatedBy: alice.id,
    });
    expect(await echoed).toBe(true);
  });

  it("keeps edits in order, one revision after another", async () => {
    const { a, b } = await pair();
    const heard = collect(b, "code-update", 1200);

    for (let i = 0; i < 5; i++) {
      const reply = await emitAck(a, "code-change", edit(`v${i}`, i));
      expect(reply).toMatchObject({ ok: true, revision: i + 1 });
    }
    const updates = await heard;
    expect(updates.map((u) => u.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(updates.map((u) => u.code)).toEqual(["v0", "v1", "v2", "v3", "v4"]);
  });

  it("applies edits sent without waiting for replies in the order they were sent", async () => {
    const { a, b } = await pair();
    const heard = collect(b, "code-update", 1200);
    const replies = [];
    a.on("code-conflict", (c) => replies.push(c));

    for (let i = 0; i < 6; i++) a.emit("code-change", edit(`p${i}`, i));
    const updates = await heard;

    expect(replies).toEqual([]);
    expect(updates.map((u) => u.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    await flushLiveCode();
    const stored = await LiveCode.findOne({ chatId: chat.id });
    expect(stored.code).toBe("p5");
    expect(stored.revision).toBe(6);
  });

  it("defaults the language and file name, and keeps the size limits", async () => {
    const a = await server.client(alice);
    const reply = await emitAck(a, "code-change", {
      chatId: chat.id,
      baseRevision: 0,
      code: "x".repeat(100000),
    });
    expect(reply.ok).toBe(true);
    await flushLiveCode();
    const stored = await LiveCode.findOne({ chatId: chat.id });
    expect(stored.language).toBe("plaintext");
    expect(stored.fileName).toBe("main");

    const tooBig = await emitAck(a, "code-change", edit("x".repeat(100001), 1));
    expect(tooBig.ok).toBe(false);
    expect(tooBig.error.code).toBe("VALIDATION_ERROR");
    const noBase = await emitAck(a, "code-change", {
      chatId: chat.id,
      code: "y",
    });
    expect(noBase.error.code).toBe("VALIDATION_ERROR");
    const badBase = await emitAck(a, "code-change", edit("y", -1));
    expect(badBase.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("conflicts", () => {
  it("refuse a stale base and return the current document", async () => {
    const { a, b } = await pair();
    await emitAck(a, "code-change", edit("from alice", 0));

    const conflict = once(b, "code-conflict");
    const quiet = never(a, "code-update");
    const reply = await emitAck(b, "code-change", edit("from bob", 0));

    expect(reply).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT" },
      chatId: chat.id,
      document: {
        code: "from alice",
        language: "python",
        fileName: "a.py",
        revision: 1,
        updatedBy: alice.id,
      },
    });
    expect((await conflict).document.revision).toBe(1);
    // Nothing was overwritten and nobody was told about the refused edit.
    expect(await quiet).toBe(true);
    await flushLiveCode();
    expect((await LiveCode.findOne({ chatId: chat.id })).code).toBe(
      "from alice"
    );
  });

  it("let the loser retry on the revision it was given", async () => {
    const { a, b } = await pair();
    await emitAck(a, "code-change", edit("one", 0));
    const refused = await emitAck(b, "code-change", edit("two", 0));

    const retry = await emitAck(
      b,
      "code-change",
      edit("two, merged", refused.document.revision)
    );
    expect(retry).toMatchObject({ ok: true, revision: 2 });
  });

  it("accept only one of two edits made on the same revision", async () => {
    const { a, b } = await pair();
    const replies = await Promise.all([
      emitAck(a, "code-change", edit("A", 0)),
      emitAck(b, "code-change", edit("B", 0)),
    ]);
    expect(replies.filter((r) => r.ok)).toHaveLength(1);
    const loser = replies.find((r) => !r.ok);
    expect(loser.error.code).toBe("REVISION_CONFLICT");
    expect(loser.document.revision).toBe(1);
    expect(loser.document.code).toBe(
      replies.find((r) => r.ok) && loser.document.code
    );
  });

  it("treat a base from the future as a conflict too", async () => {
    const a = await server.client(alice);
    await emitAck(a, "code-change", edit("one", 0));
    const reply = await emitAck(a, "code-change", edit("two", 5));
    expect(reply).toMatchObject({
      ok: false,
      document: { revision: 1, code: "one" },
    });
  });

  it("refuse a first edit that claims an existing revision", async () => {
    const a = await server.client(alice);
    const reply = await emitAck(a, "code-change", edit("x", 3));
    expect(reply).toMatchObject({
      ok: false,
      document: { code: "", revision: 0 },
    });
    await flushLiveCode();
    expect(await LiveCode.countDocuments()).toBe(0);
  });

  it("are decided across app instances", async () => {
    const { a, b } = await pair(server, other);
    const heard = once(a, "code-update");
    await emitAck(a, "code-change", edit("on the first", 0));

    const stale = await emitAck(b, "code-change", edit("on the second", 0));
    expect(stale).toMatchObject({ ok: false, document: { revision: 1 } });
    const fresh = await emitAck(b, "code-change", edit("agreed", 1));
    expect(fresh).toMatchObject({ ok: true, revision: 2 });
    expect((await heard).revision).toBe(2);
  });

  it("work without Redis, on a single instance", async () => {
    await withEnv({ REDIS_URL: "" }, async () => {
      const alone = await startSocketServer();
      try {
        const a = await alone.client(alice);
        expect(await emitAck(a, "code-change", edit("1", 0))).toMatchObject({
          ok: true,
          revision: 1,
        });
        expect(await emitAck(a, "code-change", edit("2", 0))).toMatchObject({
          ok: false,
          document: { revision: 1 },
        });
        expect(await emitAck(a, "code-change", edit("3", 1))).toMatchObject({
          ok: true,
          revision: 2,
        });
      } finally {
        await alone.close();
      }
    });
  });
});

describe("saving", () => {
  it("does not write on every edit", async () => {
    await withEnv({ LIVE_CODE_FLUSH_MS: "600" }, async () => {
      const writes = vi.spyOn(LiveCode, "updateOne");
      try {
        const a = await server.client(alice);
        for (let i = 0; i < 12; i++) {
          await emitAck(a, "code-change", edit(`keystroke ${i}`, i));
        }
        // Accepted, but not saved yet.
        expect(await LiveCode.countDocuments({ chatId: chat.id })).toBe(0);
        expect(writes).not.toHaveBeenCalled();

        await sleep(1000);
        expect(writes.mock.calls.length).toBeGreaterThan(0);
        expect(writes.mock.calls.length).toBeLessThan(4);
        const stored = await LiveCode.findOne({ chatId: chat.id });
        expect(stored.code).toBe("keystroke 11");
        expect(stored.revision).toBe(12);
      } finally {
        writes.mockRestore();
      }
    });
  });

  it("saves when the user disconnects, without waiting for the delay", async () => {
    await withEnv({ LIVE_CODE_FLUSH_MS: "60000" }, async () => {
      const a = await server.client(alice);
      await emitAck(a, "code-change", edit("before leaving", 0));
      expect(await LiveCode.countDocuments({ chatId: chat.id })).toBe(0);

      a.close();
      const deadline = Date.now() + 3000;
      let stored = null;
      while (!stored && Date.now() < deadline) {
        await sleep(50);
        stored = await LiveCode.findOne({ chatId: chat.id });
      }
      expect(stored?.code).toBe("before leaving");
      expect(stored?.revision).toBe(1);
    });
  });

  it("saves everything that is waiting when the server shuts down", async () => {
    await withEnv({ LIVE_CODE_FLUSH_MS: "60000" }, async () => {
      const a = await server.client(alice);
      const second = await Chat.create({ members: [alice.id, bob.id] });
      await emitAck(a, "code-change", edit("first chat", 0));
      await emitAck(a, "code-change", {
        ...edit("second chat", 0),
        chatId: second.id,
      });
      expect(await LiveCode.countDocuments()).toBe(0);

      await flushLiveCode();
      expect(await LiveCode.countDocuments()).toBe(2);
      expect((await LiveCode.findOne({ chatId: second.id })).code).toBe(
        "second chat"
      );
    });
  });

  it("is saved still when it is asked for before the delay is over", async () => {
    await withEnv({ LIVE_CODE_FLUSH_MS: "60000" }, async () => {
      const a = await server.client(alice);
      await emitAck(a, "code-change", edit("latest", 0));

      const res = await request(app)
        .get(`/api/v1/live-code/${chat.id}`)
        .set(bearer(bob.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        code: "latest",
        revision: 1,
        chatId: chat.id,
      });
    });
  });

  it("sends later joiners the newest document with its revision", async () => {
    await withEnv({ LIVE_CODE_FLUSH_MS: "60000" }, async () => {
      const a = await server.client(alice);
      await emitAck(a, "code-change", edit("newest", 0));

      const b = await server.client(bob);
      const loaded = once(b, "load-code");
      b.emit("join-live-code", { chatId: chat.id });
      expect(await loaded).toMatchObject({ code: "newest", revision: 1 });
    });
  });

  it("keeps a single stored document when many first edits arrive together", async () => {
    await LiveCode.init();
    const { a, b } = await pair();
    const replies = await Promise.all(
      [a, b, a, b, a, b].map((socket, i) =>
        emitAck(socket, "code-change", edit(`v${i}`, 0))
      )
    );
    expect(replies.filter((r) => r.ok)).toHaveLength(1);
    await flushLiveCode();
    expect(await LiveCode.countDocuments({ chatId: chat.id })).toBe(1);
  });

  it("treats a stored document without a revision as revision 0", async () => {
    await LiveCode.collection.insertOne({
      chatId: new mongoose.Types.ObjectId(chat.id),
      code: "from before",
      language: "js",
      fileName: "old.js",
    });

    const b = await server.client(bob);
    const loaded = once(b, "load-code");
    b.emit("join-live-code", { chatId: chat.id });
    expect(await loaded).toMatchObject({ code: "from before", revision: 0 });

    const reply = await emitAck(b, "code-change", edit("after", 0));
    expect(reply).toMatchObject({ ok: true, revision: 1 });
    await flushLiveCode();
    const stored = await LiveCode.findOne({ chatId: chat.id });
    expect(stored.code).toBe("after");
    expect(stored.revision).toBe(1);
    expect(await LiveCode.countDocuments()).toBe(1);
  });
});

describe("permissions", () => {
  it("keep non-members from reading or writing", async () => {
    await LiveCode.create({ chatId: chat.id, code: "private" });
    const c = await server.client(carol);

    const joinError = once(c, "socket-error");
    const leaked = never(c, "load-code");
    c.emit("join-live-code", { chatId: chat.id });
    expect(await joinError).toMatchObject({ event: "join-live-code" });
    expect(await leaked).toBe(true);

    const reply = await emitAck(c, "code-change", edit("overwritten", 0));
    expect(reply).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Not a member of this chat" },
    });
    await flushLiveCode();
    const stored = await LiveCode.findOne({ chatId: chat.id });
    expect(stored.code).toBe("private");
    expect(stored.revision).toBe(0);

    const rest = await request(app)
      .get(`/api/v1/live-code/${chat.id}`)
      .set(bearer(carol.token));
    expect(rest.status).toBe(403);
  });

  it("answer unknown chats with an error and keep running", async () => {
    const a = await server.client(alice);
    const unknown = await emitAck(
      a,
      "code-change",
      edit("x", 0, { chatId: new mongoose.Types.ObjectId().toString() })
    );
    expect(unknown.ok).toBe(false);

    const bad = await emitAck(a, "code-change", edit("x", 0, { chatId: "no" }));
    expect(bad).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        details: [{ field: "chatId", message: expect.any(String) }],
      },
    });

    expect(await emitAck(a, "code-change", edit("fine", 0))).toMatchObject({
      ok: true,
    });
  });

  it("stop a removed member from editing or receiving edits", async () => {
    const group = await Chat.create({
      isGroupChat: true,
      chatName: "team",
      members: [alice.id, bob.id, carol.id],
      admins: [alice.id],
    });
    const a = await server.client(alice);
    const c = await server.client(carol);
    for (const s of [a, c]) s.emit("join-live-code", { chatId: group.id });
    await sleep(200);

    const removed = await request(app)
      .patch("/api/v1/group/remove")
      .set(bearer(alice.token))
      .send({ chatId: group.id, userId: carol.id });
    expect(removed.status).toBe(200);
    // The other instance applies the removal a moment later.
    await sleep(200);

    const silent = never(c, "code-update");
    await emitAck(a, "code-change", edit("secret", 0, { chatId: group.id }));
    expect(await silent).toBe(true);

    const reply = await emitAck(
      c,
      "code-change",
      edit("let me in", 1, { chatId: group.id })
    );
    expect(reply.error.code).toBe("FORBIDDEN");
  });
});
