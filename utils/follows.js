import Follow from "../models/Follow.js";

export async function followCounts(userId) {
  const [followersCount, followingCount] = await Promise.all([
    Follow.countDocuments({ following: userId }),
    Follow.countDocuments({ follower: userId }),
  ]);
  return { followersCount, followingCount };
}

// Ids of the users that `userId` follows.
export const followedIds = (userId) =>
  Follow.distinct("following", { follower: userId });
