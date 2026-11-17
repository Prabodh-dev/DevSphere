import Follow from "../models/Follow.js";
import User from "../models/User.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";
import { notifyUser } from "./notificationService.js";

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

// Follow a user. The unique index on (follower, following) decides races.
export async function follow(actor, targetUserId, io) {
  if (targetUserId === actor._id.toString()) {
    throw badRequest("You can't follow yourself");
  }
  if (!(await User.exists({ _id: targetUserId }))) {
    throw notFound("User not found");
  }

  try {
    await Follow.create({ follower: actor._id, following: targetUserId });
  } catch (err) {
    if (err.code === 11000) throw badRequest("Already following this user");
    throw err;
  }

  await notifyUser(io, {
    userId: targetUserId,
    type: "follow",
    content: `${actor.username} started following you`,
    fromUser: actor._id,
  });
}

// Repeating an unfollow is harmless.
export async function unfollow(actorId, targetUserId) {
  if (!(await User.exists({ _id: targetUserId }))) {
    throw notFound("User not found");
  }
  await Follow.deleteOne({ follower: actorId, following: targetUserId });
}

// Follow records pointing at a user, newest first, with the follower loaded.
export async function listFollowers(userId, { limit, cursor }) {
  if (!(await User.exists({ _id: userId }))) throw notFound("User not found");

  return paginate(Follow, {
    filter: { following: userId },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("follower", "username avatarKey"),
  });
}

// Follow records of a user, newest first, with the followed user loaded.
export async function listFollowing(userId, { limit, cursor }) {
  if (!(await User.exists({ _id: userId }))) throw notFound("User not found");

  return paginate(Follow, {
    filter: { follower: userId },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("following", "username avatarKey"),
  });
}
