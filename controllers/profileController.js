import UserProfile from "../models/UserProfile.js";
import User from "../models/User.js";
import { uploadToS3 } from "../utils/s3Utils.js";
import { notFound } from "../utils/httpError.js";

export const createOrUpdateProfile = async (req, res) => {
  // Only touch the fields that were actually sent.
  const profileData = Object.fromEntries(
    Object.entries(req.valid.body).filter(([, value]) => value !== undefined)
  );

  if (req.file) {
    const avatarUrl = await uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    profileData.avatar = avatarUrl;
    // Other endpoints read the avatar from the user record.
    await User.findByIdAndUpdate(req.user._id, { avatar: avatarUrl });
  }

  const profile = await UserProfile.findOneAndUpdate(
    { user: req.user._id },
    profileData,
    { new: true, upsert: true }
  );

  res.status(200).json(profile);
};

export const getMyProfile = async (req, res) => {
  const profile = await UserProfile.findOne({ user: req.user._id });
  if (!profile) throw notFound("Profile not found");
  res.status(200).json(profile);
};

export const getUserProfileById = async (req, res) => {
  const profile = await UserProfile.findOne({
    user: req.valid.params.userId,
  }).populate("user", "username");
  if (!profile) throw notFound("Profile not found");
  res.status(200).json(profile);
};
