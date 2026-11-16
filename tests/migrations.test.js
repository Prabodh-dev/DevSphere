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

describe("003-profile-fields-to-user", () => {
  const name = "003-profile-fields-to-user";

  it("moves profile-only values onto the user and removes the duplicates", async () => {
    const [onlyProfile, both, orphanOwner] = [id(), id(), id()];
    await db.collection("users").insertMany([
      { _id: onlyProfile, username: "p", avatarKey: "", tags: [] },
      {
        _id: both,
        username: "b",
        avatarKey: "avatars/user.png",
        tags: ["a", "b"],
      },
    ]);
    await db.collection("userprofiles").insertMany([
      {
        user: onlyProfile,
        bio: "x",
        avatarKey: "avatars/profile.png",
        tags: ["go", "rust"],
        avatar: "https://old.example.test/a.png",
      },
      {
        user: both,
        avatarKey: "avatars/profile-two.png",
        tags: ["b", "c", "x".repeat(31)],
      },
      { user: orphanOwner, tags: ["lost"], avatarKey: "avatars/lost.png" },
      { user: id(), bio: "already clean" },
    ]);

    expect((await dryRun(name)).changed).toBe(3);
    expect(
      await db
        .collection("userprofiles")
        .countDocuments({ tags: { $exists: true } })
    ).toBe(3);

    expect((await runTwice(name)).changed).toBe(3);

    const first = await db.collection("users").findOne({ _id: onlyProfile });
    expect(first.avatarKey).toBe("avatars/profile.png");
    expect(first.tags).toEqual(["go", "rust"]);

    // The user's own avatar wins; tags are merged without duplicates.
    const second = await db.collection("users").findOne({ _id: both });
    expect(second.avatarKey).toBe("avatars/user.png");
    expect(second.tags).toEqual(["a", "b", "c"]);

    expect(
      await db.collection("userprofiles").countDocuments({
        $or: [
          { tags: { $exists: true } },
          { avatarKey: { $exists: true } },
          { avatar: { $exists: true } },
        ],
      })
    ).toBe(0);
    expect(
      (await db.collection("userprofiles").findOne({ user: onlyProfile })).bio
    ).toBe("x");
  });

  it("caps the merged tag list at 20", async () => {
    const user = id();
    const many = Array.from({ length: 15 }, (_, i) => `u${i}`);
    const more = Array.from({ length: 15 }, (_, i) => `p${i}`);
    await db
      .collection("users")
      .insertOne({ _id: user, username: "u", tags: many });
    await db.collection("userprofiles").insertOne({ user, tags: more });

    await runTwice(name);
    const merged = (await db.collection("users").findOne({ _id: user })).tags;
    expect(merged).toHaveLength(20);
    expect(merged.slice(0, 15)).toEqual(many);
  });
});

describe("004-chat-latest-message", () => {
  const name = "004-chat-latest-message";

  it("sets latestMessage on chats that have messages and leaves others alone", async () => {
    const [withMessages, empty, alreadySet] = [id(), id(), id()];
    await db.collection("chats").insertMany([
      { _id: withMessages, members: [id()], updatedAt: new Date("2024-03-03") },
      { _id: empty, members: [id()] },
      { _id: alreadySet, members: [id()], latestMessage: id() },
    ]);
    const [older, newer] = [id(), id()];
    await db.collection("messages").insertMany([
      {
        _id: older,
        chat: withMessages,
        createdAt: new Date("2024-01-01"),
        text: "a",
      },
      {
        _id: newer,
        chat: withMessages,
        createdAt: new Date("2024-02-01"),
        text: "b",
      },
      { chat: alreadySet, createdAt: new Date("2024-02-01"), text: "c" },
    ]);

    expect((await dryRun(name)).changed).toBe(1);
    expect(
      await db
        .collection("chats")
        .countDocuments({ _id: withMessages, latestMessage: { $exists: true } })
    ).toBe(0);

    expect((await runTwice(name)).changed).toBe(1);

    const chat = await db.collection("chats").findOne({ _id: withMessages });
    expect(chat.latestMessage).toEqual(newer);
    // Backfilling does not change the activity time.
    expect(chat.updatedAt).toEqual(new Date("2024-03-03"));
    expect(
      (await db.collection("chats").findOne({ _id: empty })).latestMessage
    ).toBeUndefined();
  });
});

describe("005-merge-duplicate-live-code", () => {
  const name = "005-merge-duplicate-live-code";

  it("keeps the most recently updated document for each chat", async () => {
    const [chatA, chatB] = [id(), id()];
    const [oldA, newestA, middleA, onlyB] = [id(), id(), id(), id()];
    await db.collection("livecodes").insertMany([
      {
        _id: oldA,
        chatId: chatA,
        code: "old",
        updatedAt: new Date("2024-01-01"),
      },
      {
        _id: newestA,
        chatId: chatA,
        code: "newest",
        updatedAt: new Date("2024-03-01"),
      },
      {
        _id: middleA,
        chatId: chatA,
        code: "middle",
        updatedAt: new Date("2024-02-01"),
      },
      {
        _id: onlyB,
        chatId: chatB,
        code: "single",
        updatedAt: new Date("2024-01-01"),
      },
    ]);

    expect((await dryRun(name)).changed).toBe(2);
    expect(await db.collection("livecodes").countDocuments()).toBe(4);

    expect((await runTwice(name)).changed).toBe(2);

    const left = await db
      .collection("livecodes")
      .find({})
      .sort({ code: 1 })
      .toArray();
    expect(left.map((d) => d.code)).toEqual(["newest", "single"]);
  });

  it("breaks ties by document id", async () => {
    const chatId = id();
    const [first, second] = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];
    const same = new Date("2024-01-01");
    await db.collection("livecodes").insertMany([
      { _id: first, chatId, code: "first", updatedAt: same },
      { _id: second, chatId, code: "second", updatedAt: same },
    ]);
    await runTwice(name);
    const left = await db.collection("livecodes").find({}).toArray();
    expect(left.map((d) => d.code)).toEqual(["second"]);
  });
});
