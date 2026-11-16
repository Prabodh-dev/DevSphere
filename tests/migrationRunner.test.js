import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { runMigrations } from "../utils/migrationRunner.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { controlledEnv } from "./helpers/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let dir;
let db;

// A tiny migration that tags documents that have no "migrated" flag yet.
const sample = (name, field) => `
export const description = "sample ${name}";
export async function run({ db, dryRun }) {
  const filter = { ${field}: { $exists: false } };
  const count = await db.collection("things").countDocuments(filter);
  if (!dryRun && count > 0) {
    await db.collection("things").updateMany(filter, { $set: { ${field}: true } });
  }
  return { changed: count };
}
`;

beforeAll(async () => {
  await connectTestDb();
  db = mongoose.connection.db;
});
afterAll(async () => {
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "migrations-"));
  writeFileSync(path.join(dir, "001-first.js"), sample("first", "a"));
  writeFileSync(path.join(dir, "002-second.js"), sample("second", "b"));
  await db.collection("things").insertMany([{ n: 1 }, { n: 2 }]);
});

describe("runMigrations", () => {
  it("applies steps in order and records them", async () => {
    const results = await runMigrations(db, { dir });
    expect(results.map((r) => [r.name, r.status, r.changed])).toEqual([
      ["001-first", "applied", 2],
      ["002-second", "applied", 2],
    ]);

    const recorded = await db
      .collection("migrations")
      .find({})
      .sort({ name: 1 })
      .toArray();
    expect(recorded.map((m) => m.name)).toEqual(["001-first", "002-second"]);
    expect(recorded[0].appliedAt).toBeInstanceOf(Date);
    expect(
      await db.collection("things").countDocuments({ a: true, b: true })
    ).toBe(2);
  });

  it("skips steps that were already applied", async () => {
    await runMigrations(db, { dir });
    const again = await runMigrations(db, { dir });
    expect(again.map((r) => [r.status, r.changed])).toEqual([
      ["skipped", 0],
      ["skipped", 0],
    ]);
    expect(await db.collection("migrations").countDocuments()).toBe(2);
  });

  it("picks up only the new steps", async () => {
    await runMigrations(db, { dir });
    writeFileSync(path.join(dir, "003-third.js"), sample("third", "c"));
    const results = await runMigrations(db, { dir });
    expect(results.map((r) => r.status)).toEqual([
      "skipped",
      "skipped",
      "applied",
    ]);
  });

  it("reports what would change on a dry run without writing", async () => {
    const results = await runMigrations(db, { dir, dryRun: true });
    expect(results.map((r) => [r.name, r.status, r.changed])).toEqual([
      ["001-first", "would-apply", 2],
      ["002-second", "would-apply", 2],
    ]);
    expect(await db.collection("things").countDocuments({ a: true })).toBe(0);
    expect(await db.collection("migrations").countDocuments()).toBe(0);
  });

  it("stops at the first failure and does not record it", async () => {
    writeFileSync(
      path.join(dir, "001-first.js"),
      `export async function run() { throw new Error("boom"); }`
    );
    await expect(runMigrations(db, { dir })).rejects.toThrow("boom");
    expect(await db.collection("migrations").countDocuments()).toBe(0);
    expect(await db.collection("things").countDocuments({ b: true })).toBe(0);
  });

  it("ignores files that are not migrations", async () => {
    writeFileSync(path.join(dir, "README.md"), "notes");
    writeFileSync(path.join(dir, "helper.js"), "export const x = 1;");
    const results = await runMigrations(db, { dir });
    expect(results).toHaveLength(2);
  });
});

describe("pnpm migrate", () => {
  function run(args, extraEnv = {}) {
    const uri = new URL(process.env.TEST_MONGO_URI);
    uri.pathname = "/devsphere_test";
    const child = spawn(process.execPath, ["scripts/migrate.js", ...args], {
      cwd: root,
      env: controlledEnv({ MONGO_URI: uri.toString(), ...extraEnv }),
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    return new Promise((resolve) =>
      child.on("exit", (code) => resolve({ code, output }))
    );
  }

  it("supports --dry-run and records nothing", async () => {
    const result = await run(["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/dry run/i);
    expect(await db.collection("migrations").countDocuments()).toBe(0);
  });

  it("fails without a database address", async () => {
    const child = spawn(process.execPath, ["scripts/migrate.js"], {
      cwd: root,
      env: controlledEnv({}),
    });
    const code = await new Promise((resolve) => child.on("exit", resolve));
    expect(code).not.toBe(0);
  });

  it("does not run when the server starts", async () => {
    const { readFileSync } = await import("fs");
    const server = readFileSync(path.join(root, "server.js"), "utf8");
    expect(server).not.toMatch(/migrat/i);
  });
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
