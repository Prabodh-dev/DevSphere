export const description =
  "Move avatar and tags from profiles onto users and remove the copies";

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

const hasProfileFields = {
  $or: [
    { avatarKey: { $exists: true } },
    { avatar: { $exists: true } },
    { tags: { $exists: true } },
  ],
};

export async function run({ db, dryRun }) {
  const profiles = db.collection("userprofiles");
  const users = db.collection("users");

  const pending = await profiles.find(hasProfileFields).toArray();
  if (dryRun) return { changed: pending.length };

  for (const profile of pending) {
    const user = await users.findOne(
      { _id: profile.user },
      { projection: { avatarKey: 1, tags: 1 } }
    );

    if (user) {
      const update = {};
      if (profile.avatarKey && !user.avatarKey) {
        update.avatarKey = profile.avatarKey;
      }
      if (Array.isArray(profile.tags) && profile.tags.length > 0) {
        // The user's tags come first; profile-only tags are added after them.
        const merged = [
          ...new Set([
            ...(user.tags ?? []),
            ...profile.tags.filter(
              (tag) =>
                typeof tag === "string" && tag && tag.length <= MAX_TAG_LENGTH
            ),
          ]),
        ].slice(0, MAX_TAGS);
        if (merged.length !== (user.tags ?? []).length) update.tags = merged;
      }
      if (Object.keys(update).length > 0) {
        await users.updateOne({ _id: user._id }, { $set: update });
      }
    }

    await profiles.updateOne(
      { _id: profile._id },
      { $unset: { avatarKey: "", avatar: "", tags: "" } }
    );
  }

  return { changed: pending.length };
}
