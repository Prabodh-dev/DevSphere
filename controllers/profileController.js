import UserProfile from "../models/UserProfile.js";
import { uploadToS3 } from "../utils/s3Utils.js";

export const createOrUpdateProfile = async (req, res) => {
  try {
    const { bio, github, tags, linkedin, website } = req.body;
    let avatarUrl;

    if (req.file) {
      avatarUrl = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

    const profileData = {
      bio,
      github,
      tags,
      linkedin,
      website,
    };

    if (avatarUrl) profileData.avatar = avatarUrl;

    const profile = await UserProfile.findOneAndUpdate(
      { user: req.user._id },
      profileData,
      { new: true, upsert: true }
    );

    res.status(200).json(profile);
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

export const getMyProfile = async (req, res) => {
  try {
    const profile = await UserProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.status(200).json(profile);
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

export const getUserProfileById = async (req, res) => {
  try {
    const profile = await UserProfile.findOne({
      user: req.params.userId,
    }).populate("user", "username");
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    res.status(200).json(profile);
  } catch (err) {
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};
