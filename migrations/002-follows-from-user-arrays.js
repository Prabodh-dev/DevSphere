import mongoose from "mongoose";

export const description =
  "Move embedded followers/following arrays into the follows collection";

const BATCH = 500;
const HEX_ID = /^[0-9a-fA-F]{24}$/;

const toId = (value) => {
  const text = String(value ?? "");
  return HEX_ID.test(text) ? new mongoose.Types.ObjectId(text) : null;
};

export async function run({ db, dryRun }) {
  const users = db.collection("users");
  const follows = db.collection("follows");
  const hasArrays = {
    $or: [{ followers: { $exists: true } }, { following: { $exists: true } }],
  };

  let changed = 0;
  const cursor = users.find(hasArrays, {
    projection: { followers: 1, following: 1 },
  });

  const flush = async (batch) => {
    // Both arrays describe the same relationships, so use both.
    const pairs = new Map();
    for (const user of batch) {
      for (const other of user.following ?? []) {
        const id = toId(other);
        if (id) pairs.set(`${user._id}>${id}`, [user._id, id]);
      }
      for (const other of user.followers ?? []) {
        const id = toId(other);
        if (id) pairs.set(`${id}>${user._id}`, [id, user._id]);
      }
    }

    // Drop self references and ids that do not belong to a user.
    const candidates = new Set();
    for (const [a, b] of pairs.values()) {
      candidates.add(String(a));
      candidates.add(String(b));
    }
    const existing = new Set(
      (
        await users
          .find(
            {
              _id: {
                $in: [...candidates].map((c) => new mongoose.Types.ObjectId(c)),
              },
            },
            { projection: { _id: 1 } }
          )
          .toArray()
      ).map((u) => String(u._id))
    );
    const valid = [...pairs.values()].filter(
      ([a, b]) =>
        String(a) !== String(b) &&
        existing.has(String(a)) &&
        existing.has(String(b))
    );

    // Pairs that already have a record are left as they are.
    const known = new Set(
      (
        await follows
          .find(
            { follower: { $in: valid.map(([a]) => a) } },
            { projection: { follower: 1, following: 1 } }
          )
          .toArray()
      ).map((f) => `${f.follower}>${f.following}`)
    );
    const missing = valid.filter(([a, b]) => !known.has(`${a}>${b}`));

    changed += missing.length + batch.length;
    if (dryRun) return;

    if (missing.length > 0) {
      const now = new Date();
      await follows.bulkWrite(
        missing.map(([follower, following]) => ({
          updateOne: {
            filter: { follower, following },
            update: { $setOnInsert: { follower, following, createdAt: now } },
            upsert: true,
          },
        }))
      );
    }
    await users.updateMany(
      { _id: { $in: batch.map((u) => u._id) } },
      { $unset: { followers: "", following: "" } }
    );
  };

  let batch = [];
  for await (const user of cursor) {
    batch.push(user);
    if (batch.length >= BATCH) {
      await flush(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await flush(batch);

  return { changed };
}
