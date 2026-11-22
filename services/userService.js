import User from "../models/User.js";
import { paginate } from "../utils/pagination.js";

export async function updateTags(userId, tags) {
  const user = await User.findByIdAndUpdate(
    userId,
    { tags },
    { returnDocument: "after" }
  );
  return user.tags;
}

// Users with a tag, in the order they signed up.
export function searchByTag(tag, { limit, cursor }) {
  return paginate(User, {
    filter: { tags: tag },
    sortField: "_id",
    direction: 1,
    limit,
    cursor,
    build: (query) => query.select("username avatarKey tags"),
  });
}
