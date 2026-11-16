export const description =
  "Give users createdAt (from the id when missing) and updatedAt";

export async function run({ db, dryRun }) {
  const users = db.collection("users");
  const pending = await users
    .find(
      {
        $or: [
          { createdAt: { $exists: false } },
          { updatedAt: { $exists: false } },
        ],
      },
      { projection: { createdAt: 1 } }
    )
    .toArray();

  if (!dryRun && pending.length > 0) {
    await users.bulkWrite(
      pending.map((user) => {
        const createdAt = user.createdAt ?? user._id.getTimestamp();
        return {
          updateOne: {
            filter: { _id: user._id },
            update: { $set: { createdAt, updatedAt: createdAt } },
          },
        };
      })
    );
  }
  return { changed: pending.length };
}
