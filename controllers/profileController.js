import UserProfile from "../models/UserProfile.js";
import User from "../models/User.js";
import { deleteMedia, uploadMedia } from "../utils/s3Utils.js";
import { notFound } from "../utils/httpError.js";
import { profileView } from "../utils/serializers.js";

const PROFILE_USER_FIELDS = "username avatarKey tags";

export const createOrUpdateProfile = async (req, res) => {
  const { tags, ...fields } = req.valid.body;

  // Bio and links live on the profile; only touch what was sent.
  const profileData = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );

  // Tags and the avatar belong to the user.
  const userData = {};
  if (tags !== undefined) userData.tags = tags;

  let previousKey;
  if (req.file) {
    userData.avatarKey = await uploadMedia({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      prefix: "avatars",
    });
    previousKey = req.user.avatarKey;
  }

  if (Object.keys(userData).length > 0) {
    await User.updateOne({ _id: req.user._id }, userData);
  }

  const profile = await UserProfile.findOneAndUpdate(
    { user: req.user._id },
    profileData,
    { new: true, upsert: true }
  );

  if (previousKey) await deleteMedia(previousKey);

  const user = await User.findById(req.user._id).select(PROFILE_USER_FIELDS);
  res.status(200).json(await profileView(profile, user));
};

export const getMyProfile = async (req, res) => {
  const profile = await UserProfile.findOne({ user: req.user._id });
  if (!profile) throw notFound("Profile not found");

  const user = await User.findById(req.user._id).select(PROFILE_USER_FIELDS);
  res.status(200).json(await profileView(profile, user));
};

export const getUserProfileById = async (req, res) => {
  const profile = await UserProfile.findOne({ user: req.valid.params.userId });
  if (!profile) throw notFound("Profile not found");

  const user = await User.findById(profile.user).select(PROFILE_USER_FIELDS);
  if (!user) throw notFound("Profile not found");
  res.status(200).json(await profileView(profile, user));
};
