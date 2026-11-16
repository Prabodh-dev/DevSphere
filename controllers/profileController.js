import UserProfile from "../models/UserProfile.js";
import User from "../models/User.js";
import { deleteMedia, uploadMedia } from "../utils/s3Utils.js";
import { notFound } from "../utils/httpError.js";
import { profileView } from "../utils/serializers.js";

export const createOrUpdateProfile = async (req, res) => {
  // Only touch the fields that were actually sent.
  const profileData = Object.fromEntries(
    Object.entries(req.valid.body).filter(([, value]) => value !== undefined)
  );

  let previousKey;
  if (req.file) {
    const key = await uploadMedia({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      prefix: "avatars",
    });
    profileData.avatarKey = key;
    previousKey = req.user.avatarKey;
    // Other endpoints read the avatar from the user record.
    await User.findByIdAndUpdate(req.user._id, { avatarKey: key });
  }

  const profile = await UserProfile.findOneAndUpdate(
    { user: req.user._id },
    profileData,
    { new: true, upsert: true }
  );

  if (previousKey) await deleteMedia(previousKey);

  res.status(200).json(await profileView(profile));
};

export const getMyProfile = async (req, res) => {
  const profile = await UserProfile.findOne({ user: req.user._id });
  if (!profile) throw notFound("Profile not found");
  res.status(200).json(await profileView(profile));
};

export const getUserProfileById = async (req, res) => {
  const profile = await UserProfile.findOne({
    user: req.valid.params.userId,
  }).populate("user", "username");
  if (!profile) throw notFound("Profile not found");
  res.status(200).json(await profileView(profile));
};
