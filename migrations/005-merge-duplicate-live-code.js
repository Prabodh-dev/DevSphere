export const description =
  "Keep one live code document per chat (the most recently updated)";

export async function run({ db, dryRun }) {
  const livecodes = db.collection("livecodes");

  const duplicated = await livecodes
    .aggregate([
      { $group: { _id: "$chatId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  let changed = 0;
  for (const { _id: chatId } of duplicated) {
    const docs = await livecodes
      .find({ chatId }, { projection: { _id: 1 } })
      .sort({ updatedAt: -1, _id: -1 })
      .toArray();
    const extras = docs.slice(1).map((doc) => doc._id);

    changed += extras.length;
    if (!dryRun) await livecodes.deleteMany({ _id: { $in: extras } });
  }
  return { changed };
}
