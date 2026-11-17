import User from "../models/User.js";
import Follow from "../models/Follow.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { publicUserView } from "../utils/serializers.js";
import { notifyUser } from "../utils/notify.js";
import { paginate } from "../utils/pagination.js";

// Follow a user. The unique index on (follower, following) decides races.
export const followUser = async (req, res) => {
  const targetUserId = req.valid.params.id;

  if (targetUserId === req.user._id.toString()) {
    throw badRequest("You can't follow yourself");
  }
  if (!(await User.exists({ _id: targetUserId }))) {
    throw notFound("User not found");
  }

  try {
    await Follow.create({ follower: req.user._id, following: targetUserId });
  } catch (err) {
    if (err.code === 11000) throw badRequest("Already following this user");
    throw err;
  }

  await notifyUser(req.app.get("io"), {
    userId: targetUserId,
    type: "follow",
    content: `${req.user.username} started following you`,
    fromUser: req.user._id,
  });

  res.status(200).json({ message: "User followed successfully" });
};

// Unfollow a user. Repeating it is harmless.
export const unfollowUser = async (req, res) => {
  const targetUserId = req.valid.params.id;

  if (!(await User.exists({ _id: targetUserId }))) {
    throw notFound("User not found");
  }
  await Follow.deleteOne({ follower: req.user._id, following: targetUserId });

  res.status(200).json({ message: "User unfollowed successfully" });
};

// Public view of the users on the other side of the follow records.
const listUsers = (follows, field) =>
  Promise.all(
    follows
      .map((follow) => follow[field])
      .filter(Boolean)
      .map(publicUserView)
  );

// Get followers of a user, newest first
export const getFollowers = async (req, res) => {
  const { id } = req.valid.params;
  const { limit, cursor } = req.valid.query;
  if (!(await User.exists({ _id: id }))) throw notFound("User not found");

  const { docs, nextCursor } = await paginate(Follow, {
    filter: { following: id },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("follower", "username avatarKey"),
  });

  res
    .status(200)
    .json({ items: await listUsers(docs, "follower"), nextCursor });
};

// Get the users someone follows, newest first
export const getFollowing = async (req, res) => {
  const { id } = req.valid.params;
  const { limit, cursor } = req.valid.query;
  if (!(await User.exists({ _id: id }))) throw notFound("User not found");

  const { docs, nextCursor } = await paginate(Follow, {
    filter: { follower: id },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("following", "username avatarKey"),
  });

  res
    .status(200)
    .json({ items: await listUsers(docs, "following"), nextCursor });
};

// Update user's tags
export const updateTags = async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { tags: req.valid.body.tags },
    { new: true }
  );

  res.status(200).json({ message: "Tags updated", tags: user.tags });
};

// Search users by tag, in the order they signed up
export const searchUsersByTag = async (req, res) => {
  const { tag, limit, cursor } = req.valid.query;

  const { docs, nextCursor } = await paginate(User, {
    filter: { tags: tag },
    sortField: "_id",
    direction: 1,
    limit,
    cursor,
    build: (query) => query.select("username avatarKey tags"),
  });

  const items = await Promise.all(
    docs.map(async (user) => ({
      ...(await publicUserView(user)),
      tags: user.tags,
    }))
  );
  res.status(200).json({ items, nextCursor });
};
