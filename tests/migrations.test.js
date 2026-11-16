import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";

let db;

beforeAll(async () => {
  await connectTestDb();
  db = mongoose.connection.db;
});
afterAll(disconnectTestDb);
beforeEach(clearTestDb);

// Runs one migration twice. The second run must not change anything.
async function runTwice(name) {
  const migration = await import(`../migrations/${name}.js`);
  const first = await migration.run({ db, dryRun: false });
  const second = await migration.run({ db, dryRun: false });
  expect(second.changed).toBe(0);
  return first;
}

async function dryRun(name) {
  const migration = await import(`../migrations/${name}.js`);
  return migration.run({ db, dryRun: true });
}

const id = () => new mongoose.Types.ObjectId();

describe("001-user-timestamps", () => {
  const name = "001-user-timestamps";

  it("keeps createdAt, fills gaps from the id and adds updatedAt", async () => {
    const old = new Date("2024-01-02T03:04:05Z");
    const withDate = id();
    const withoutDate = id();
    const alreadyDone = id();
    await db.collection("users").insertMany([
      { _id: withDate, username: "a", createdAt: old },
      { _id: withoutDate, username: "b" },
      {
        _id: alreadyDone,
        username: "c",
        createdAt: old,
        updatedAt: new Date("2025-05-05T00:00:00Z"),
      },
    ]);

    expect((await dryRun(name)).changed).toBe(2);
    expect(
      await db
        .collection("users")
        .countDocuments({ updatedAt: { $exists: true } })
    ).toBe(1);

    const result = await runTwice(name);
    expect(result.changed).toBe(2);

    const a = await db.collection("users").findOne({ _id: withDate });
    expect(a.createdAt).toEqual(old);
    expect(a.updatedAt).toEqual(old);

    const b = await db.collection("users").findOne({ _id: withoutDate });
    expect(b.createdAt).toEqual(withoutDate.getTimestamp());
    expect(b.updatedAt).toEqual(b.createdAt);

    const c = await db.collection("users").findOne({ _id: alreadyDone });
    expect(c.updatedAt).toEqual(new Date("2025-05-05T00:00:00Z"));
  });
});
