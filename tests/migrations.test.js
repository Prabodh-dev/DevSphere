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

describe("002-follows-from-user-arrays", () => {
  const name = "002-follows-from-user-arrays";

  async function seed() {
    const [a, b, c, ghost] = [id(), id(), id(), id()];
    await db.collection("users").insertMany([
      // a follows b (listed on both sides) and c (listed only on a's side)
      { _id: a, username: "a", following: [b, c, b, ghost, a], followers: [] },
      { _id: b, username: "b", followers: [a], following: [] },
      // c follows a (listed only on a's followers side)
      { _id: c, username: "c", followers: [], following: [] },
      { _id: id(), username: "d" },
    ]);
    await db
      .collection("users")
      .updateOne({ _id: a }, { $set: { followers: [c] } });
    return { a, b, c };
  }

  it("turns the arrays into follow records, skipping junk, then removes them", async () => {
    const { a, b, c } = await seed();

    const planned = await dryRun(name);
    expect(planned.changed).toBeGreaterThan(0);
    expect(await db.collection("follows").countDocuments()).toBe(0);
    expect(
      await db
        .collection("users")
        .countDocuments({ following: { $exists: true } })
    ).toBe(3);

    const result = await runTwice(name);
    expect(result.changed).toBeGreaterThan(0);

    const pairs = (await db.collection("follows").find({}).toArray())
      .map((f) => `${f.follower}>${f.following}`)
      .sort();
    expect(pairs).toEqual([`${a}>${b}`, `${a}>${c}`, `${c}>${a}`].sort());
    for (const follow of await db.collection("follows").find({}).toArray()) {
      expect(follow.createdAt).toBeInstanceOf(Date);
    }

    expect(
      await db.collection("users").countDocuments({
        $or: [
          { followers: { $exists: true } },
          { following: { $exists: true } },
        ],
      })
    ).toBe(0);
  });

  it("keeps follow records that already exist", async () => {
    const { a, b } = await seed();
    const created = new Date("2024-02-02T00:00:00Z");
    await db
      .collection("follows")
      .insertOne({ follower: a, following: b, createdAt: created });

    await runTwice(name);
    expect(
      await db
        .collection("follows")
        .countDocuments({ follower: a, following: b })
    ).toBe(1);
    const kept = await db
      .collection("follows")
      .findOne({ follower: a, following: b });
    expect(kept.createdAt).toEqual(created);
  });
});
