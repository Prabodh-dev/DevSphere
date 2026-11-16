import User from "../models/User.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { requireObjectId, requireString } from "../utils/validate.js";

// Follow a user
export const followUser = async (req, res) => {
  const targetUserId = requireObjectId(req.params.id, "user id");
  const currentUserId = req.user._id;

  if (targetUserId === currentUserId.toString()) {
    throw badRequest("You can't follow yourself");
  }

  const targetUser = await User.findById(targetUserId);
  const currentUser = await User.findById(currentUserId);

  if (!targetUser || !currentUser) throw notFound("User not found");

  if (targetUser.followers.includes(currentUserId)) {
    throw badRequest("Already following this user");
  }

  targetUser.followers.push(currentUserId);
  currentUser.following.push(targetUserId);

  await targetUser.save();
  await currentUser.save();

  res.status(200).json({ message: "User followed successfully" });
};

// Unfollow a user
export const unfollowUser = async (req, res) => {
  const targetUserId = requireObjectId(req.params.id, "user id");
  const currentUserId = req.user._id;

  const targetUser = await User.findById(targetUserId);
  const currentUser = await User.findById(currentUserId);

  if (!targetUser || !currentUser) throw notFound("User not found");

  targetUser.followers = targetUser.followers.filter(
    (id) => id.toString() !== currentUserId.toString()
  );
  currentUser.following = currentUser.following.filter(
    (id) => id.toString() !== targetUserId.toString()
  );

  await targetUser.save();
  await currentUser.save();

  res.status(200).json({ message: "User unfollowed successfully" });
};

// Get followers of a user
export const getFollowers = async (req, res) => {
  const userId = requireObjectId(req.params.id, "user id");
  const user = await User.findById(userId).populate(
    "followers",
    "username email avatar"
  );
  if (!user) throw notFound("User not found");

  res.status(200).json(user.followers);
};

// Get following of a user
export const getFollowing = async (req, res) => {
  const userId = requireObjectId(req.params.id, "user id");
  const user = await User.findById(userId).populate(
    "following",
    "username email avatar"
  );
  if (!user) throw notFound("User not found");

  res.status(200).json(user.following);
};

// Update user's tags
export const updateTags = async (req, res) => {
  const { tags } = req.body ?? {};

  if (!Array.isArray(tags) || tags.length > 20) {
    throw badRequest("Tags must be an array");
  }
  const cleanTags = tags.map((tag) => requireString(tag, "tag", { max: 30 }));

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { tags: cleanTags },
    { new: true }
  );

  res.status(200).json({ message: "Tags updated", tags: user.tags });
};

// Search users by tag
export const searchUsersByTag = async (req, res) => {
  const { tag } = req.query;

  if (tag === undefined || tag === "") {
    throw badRequest("Tag query is required");
  }
  const cleanTag = requireString(tag, "tag", { max: 30 });

  const users = await User.find({ tags: { $in: [cleanTag] } }).select(
    "username email avatar tags"
  );

  res.status(200).json(users);
};
