export const description =
  "Set latestMessage on chats that already have messages";

export async function run({ db, dryRun }) {
  const chats = db.collection("chats");
  const messages = db.collection("messages");

  let changed = 0;
  const cursor = chats.find(
    { $or: [{ latestMessage: { $exists: false } }, { latestMessage: null }] },
    { projection: { _id: 1 } }
  );

  for await (const chat of cursor) {
    const [latest] = await messages
      .find({ chat: chat._id }, { projection: { _id: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();
    if (!latest) continue;

    changed += 1;
    // Written directly, so the chat's updatedAt is left as it was.
    if (!dryRun) {
      await chats.updateOne(
        { _id: chat._id },
        { $set: { latestMessage: latest._id } }
      );
    }
  }
  return { changed };
}
