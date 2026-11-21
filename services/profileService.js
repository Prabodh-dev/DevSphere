import User from "../models/User.js";
import UserProfile from "../models/UserProfile.js";
import { notFound } from "../utils/httpError.js";
import { deleteMedia, uploadMedia } from "../utils/s3Utils.js";
import { followCounts } from "./followService.js";

const PROFILE_USER_FIELDS = "username avatarKey tags";

async function withUserAndCounts(profile, userId) {
  const user = await User.findById(userId).select(PROFILE_USER_FIELDS);
  if (!user) throw notFound("Profile not found");
  return { profile, user, counts: await followCounts(user._id) };
}

// Creates or updates the profile. Only the fields that were sent change: bio
// and links live on the profile, tags and the avatar on the user.
export async function saveProfile(currentUser, { tags, ...fields }, file) {
  const profileData = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );

  const userData = {};
  if (tags !== undefined) userData.tags = tags;

  let previousKey;
  if (file) {
    userData.avatarKey = await uploadMedia({
      buffer: file.buffer,
      mimetype: file.mimetype,
      prefix: "avatars",
    });
    previousKey = currentUser.avatarKey;
  }

  if (Object.keys(userData).length > 0) {
    await User.updateOne({ _id: currentUser._id }, userData);
  }

  const profile = await UserProfile.findOneAndUpdate(
    { user: currentUser._id },
    profileData,
    { returnDocument: "after", upsert: true }
  );

  if (previousKey) await deleteMedia(previousKey);

  return withUserAndCounts(profile, currentUser._id);
}

export async function getProfile(userId) {
  const profile = await UserProfile.findOne({ user: userId });
  if (!profile) throw notFound("Profile not found");
  return withUserAndCounts(profile, profile.user);
}
