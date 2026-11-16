import User from "../models/User.js";
import Follow from "../models/Follow.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { publicUserView } from "../utils/serializers.js";
import { notifyUser } from "../utils/notify.js";

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
const listUsers = async (follows, field) => {
  const users = follows.map((follow) => follow[field]).filter(Boolean);
  return Promise.all(users.map(publicUserView));
};

// Get followers of a user, newest first
export const getFollowers = async (req, res) => {
  const { id } = req.valid.params;
  const { limit, skip } = req.valid.query;
  if (!(await User.exists({ _id: id }))) throw notFound("User not found");

  const follows = await Follow.find({ following: id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("follower", "username avatarKey");

  res.status(200).json(await listUsers(follows, "follower"));
};

// Get the users someone follows, newest first
export const getFollowing = async (req, res) => {
  const { id } = req.valid.params;
  const { limit, skip } = req.valid.query;
  if (!(await User.exists({ _id: id }))) throw notFound("User not found");

  const follows = await Follow.find({ follower: id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("following", "username avatarKey");

  res.status(200).json(await listUsers(follows, "following"));
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

// Search users by tag
export const searchUsersByTag = async (req, res) => {
  const users = await User.find({ tags: req.valid.query.tag }).select(
    "username avatarKey tags"
  );

  res.status(200).json(
    await Promise.all(
      users.map(async (user) => ({
        ...(await publicUserView(user)),
        tags: user.tags,
      }))
    )
  );
};
