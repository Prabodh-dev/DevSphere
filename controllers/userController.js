import User from "../models/User.js";

// Follow a user
export const followUser = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.user._id;

    if (targetUserId === currentUserId.toString()) {
      return res.status(400).json({ message: "You can't follow yourself" });
    }

    const targetUser = await User.findById(targetUserId);
    const currentUser = await User.findById(currentUserId);

    if (!targetUser || !currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser.followers.includes(currentUserId)) {
      return res.status(400).json({ message: "Already following this user" });
    }

    targetUser.followers.push(currentUserId);
    currentUser.following.push(targetUserId);

    await targetUser.save();
    await currentUser.save();

    res.status(200).json({ message: "User followed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Unfollow a user
export const unfollowUser = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.user._id;

    const targetUser = await User.findById(targetUserId);
    const currentUser = await User.findById(currentUserId);

    if (!targetUser || !currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    targetUser.followers = targetUser.followers.filter(
      (id) => id.toString() !== currentUserId.toString()
    );
    currentUser.following = currentUser.following.filter(
      (id) => id.toString() !== targetUserId.toString()
    );

    await targetUser.save();
    await currentUser.save();

    res.status(200).json({ message: "User unfollowed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get followers of a user
export const getFollowers = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate(
      "followers",
      "username email avatar"
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user.followers);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get following of a user
export const getFollowing = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate(
      "following",
      "username email avatar"
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user.following);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
// Update user's tags
export const updateTags = async (req, res) => {
  try {
    const userId = req.user._id;
    const { tags } = req.body;

    if (!Array.isArray(tags)) {
      return res.status(400).json({ message: "Tags must be an array" });
    }

    const user = await User.findByIdAndUpdate(userId, { tags }, { new: true });

    res.status(200).json({ message: "Tags updated", tags: user.tags });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
// Search users by tag
export const searchUsersByTag = async (req, res) => {
  try {
    const { tag } = req.query;

    if (!tag) {
      return res.status(400).json({ message: "Tag query is required" });
    }

    const users = await User.find({ tags: { $in: [tag] } }).select(
      "username email avatar tags"
    );

    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
