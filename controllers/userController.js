import * as follows from "../services/followService.js";
import * as users from "../services/userService.js";
import { publicUserView } from "../utils/serializers.js";

// Public view of the users on the other side of the follow records.
const listUsers = (items, field) =>
  Promise.all(
    items
      .map((follow) => follow[field])
      .filter(Boolean)
      .map(publicUserView)
  );

export const followUser = async (req, res) => {
  await follows.follow(req.user, req.valid.params.id, req.app.get("io"));
  res.status(200).json({ message: "User followed successfully" });
};

export const unfollowUser = async (req, res) => {
  await follows.unfollow(req.user._id, req.valid.params.id);
  res.status(200).json({ message: "User unfollowed successfully" });
};

export const getFollowers = async (req, res) => {
  const { docs, nextCursor } = await follows.listFollowers(
    req.valid.params.id,
    req.valid.query
  );
  res
    .status(200)
    .json({ items: await listUsers(docs, "follower"), nextCursor });
};

export const getFollowing = async (req, res) => {
  const { docs, nextCursor } = await follows.listFollowing(
    req.valid.params.id,
    req.valid.query
  );
  res
    .status(200)
    .json({ items: await listUsers(docs, "following"), nextCursor });
};

export const updateTags = async (req, res) => {
  const tags = await users.updateTags(req.user._id, req.valid.body.tags);
  res.status(200).json({ message: "Tags updated", tags });
};

export const searchUsersByTag = async (req, res) => {
  const { tag, ...page } = req.valid.query;
  const { docs, nextCursor } = await users.searchByTag(tag, page);

  const items = await Promise.all(
    docs.map(async (user) => ({
      ...(await publicUserView(user)),
      tags: user.tags,
    }))
  );
  res.status(200).json({ items, nextCursor });
};
