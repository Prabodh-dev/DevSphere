import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import mongoose from "mongoose";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import Status from "../models/Status.js";
import Report from "../models/Report.js";
import LiveCode from "../models/LiveCode.js";
import { connectTestDb, disconnectTestDb, testMongoUri } from "./helpers/db.js";
import { controlledEnv } from "./helpers/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

const keys = async (Model) => {
  await Model.init();
  return (await Model.collection.indexes()).map((i) => ({
    key: i.key,
    unique: Boolean(i.unique),
  }));
};
const has = (indexes, key, unique = false) =>
  indexes.some(
    (i) => JSON.stringify(i.key) === JSON.stringify(key) && i.unique === unique
  );

describe("declared indexes", () => {
  it("cover the main queries", async () => {
    expect(has(await keys(Message), { chat: 1, createdAt: -1 })).toBe(true);
    expect(has(await keys(Chat), { members: 1, updatedAt: -1 })).toBe(true);
    expect(has(await keys(Notification), { user: 1, createdAt: -1 })).toBe(
      true
    );
    expect(has(await keys(Status), { user: 1, visibleUntil: 1 })).toBe(true);

    const reports = await keys(Report);
    expect(has(reports, { targetType: 1, targetId: 1 })).toBe(true);
    expect(has(reports, { createdAt: -1 })).toBe(true);
  });

  it("make live code unique per chat", async () => {
    expect(has(await keys(LiveCode), { chatId: 1 }, true)).toBe(true);
    const chatId = new mongoose.Types.ObjectId();
    await LiveCode.create({ chatId, code: "a" });
    await expect(LiveCode.create({ chatId, code: "b" })).rejects.toMatchObject({
      code: 11000,
    });
    await LiveCode.deleteMany({});
  });
});

describe("MONGO_AUTO_INDEX", () => {
  it("is applied to mongoose", async () => {
    expect(mongoose.get("autoIndex")).toBe(true);

    vi.resetModules();
    process.env.NODE_ENV = "production";
    process.env.MONGO_AUTO_INDEX = "";
    try {
      await import("../config/mongoose.js");
      expect(mongoose.get("autoIndex")).toBe(false);
    } finally {
      process.env.NODE_ENV = "test";
      process.env.MONGO_AUTO_INDEX = "true";
      mongoose.set("autoIndex", true);
    }
  });
});

describe("pnpm db:indexes", () => {
  function run(args = []) {
    const child = spawn(
      process.execPath,
      ["scripts/sync-indexes.js", ...args],
      {
        cwd: root,
        env: controlledEnv({ MONGO_URI: testMongoUri() }),
      }
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    return new Promise((resolve) =>
      child.on("exit", (code) => resolve({ code, output }))
    );
  }

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  it("creates the declared indexes and drops stale ones", async () => {
    await mongoose.connection.db
      .collection("messages")
      .createIndex({ text: 1 });

    const result = await run();
    expect(result.code).toBe(0);

    const indexes = (
      await mongoose.connection.db.collection("messages").indexes()
    ).map((i) => i.key);
    expect(indexes).toContainEqual({ chat: 1, createdAt: -1 });
    expect(indexes).not.toContainEqual({ text: 1 });
    expect(
      (await mongoose.connection.db.collection("livecodes").indexes()).some(
        (i) => i.unique && i.key.chatId === 1
      )
    ).toBe(true);
  });

  it("only reports on a dry run", async () => {
    await mongoose.connection.db
      .collection("messages")
      .createIndex({ text: 1 });

    const result = await run(["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/dry run/i);
    expect(result.output).toMatch(/messages/);

    const indexes = (
      await mongoose.connection.db.collection("messages").indexes()
    ).map((i) => i.key);
    expect(indexes).toContainEqual({ text: 1 });
    expect(indexes).not.toContainEqual({ chat: 1, createdAt: -1 });
  });

  it("explains how to fix duplicate live code documents", async () => {
    const chatId = new mongoose.Types.ObjectId();
    await mongoose.connection.db.collection("livecodes").insertMany([
      { chatId, code: "a" },
      { chatId, code: "b" },
    ]);

    const blocked = await run();
    expect(blocked.code).not.toBe(0);
    expect(blocked.output).toMatch(/pnpm migrate/);

    const migration =
      await import("../migrations/005-merge-duplicate-live-code.js");
    await migration.run({ db: mongoose.connection.db, dryRun: false });
    expect((await run()).code).toBe(0);
  });
});
