import User from "../models/User.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { publicUserView } from "../utils/serializers.js";

// Follow a user
export const followUser = async (req, res) => {
  const targetUserId = req.valid.params.id;
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
  const targetUserId = req.valid.params.id;
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
  const user = await User.findById(req.valid.params.id).populate(
    "followers",
    "username avatarKey"
  );
  if (!user) throw notFound("User not found");

  res.status(200).json(await Promise.all(user.followers.map(publicUserView)));
};

// Get following of a user
export const getFollowing = async (req, res) => {
  const user = await User.findById(req.valid.params.id).populate(
    "following",
    "username avatarKey"
  );
  if (!user) throw notFound("User not found");

  res.status(200).json(await Promise.all(user.following.map(publicUserView)));
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
