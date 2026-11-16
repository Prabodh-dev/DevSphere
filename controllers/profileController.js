import UserProfile from "../models/UserProfile.js";
import User from "../models/User.js";
import { uploadToS3 } from "../utils/s3Utils.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { optionalString, requireObjectId } from "../utils/validate.js";

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

// Multipart forms send tags as a string ("a, b") or as repeated fields,
// JSON bodies send an array. Always end up with a clean array of strings.
function readTags(value) {
  if (value === undefined || value === null) return undefined;

  const raw = Array.isArray(value) ? value : String(value).split(",");
  if (!raw.every((tag) => typeof tag === "string")) {
    throw badRequest("tags must be strings");
  }

  const tags = raw.map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > MAX_TAGS || tags.some((t) => t.length > MAX_TAG_LENGTH)) {
    throw badRequest("Too many tags or a tag is too long");
  }
  return tags;
}

export const createOrUpdateProfile = async (req, res) => {
  const body = req.body ?? {};

  const fields = {
    bio: optionalString(body.bio, "bio", { max: 300 }),
    github: optionalString(body.github, "github", { max: 200 }),
    linkedin: optionalString(body.linkedin, "linkedin", { max: 200 }),
    website: optionalString(body.website, "website", { max: 200 }),
    tags: readTags(body.tags),
  };

  // Only touch the fields that were actually sent.
  const profileData = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
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
  const userId = requireObjectId(req.params.userId, "userId");
  const profile = await UserProfile.findOne({ user: userId }).populate(
    "user",
    "username"
  );
  if (!profile) throw notFound("Profile not found");
  res.status(200).json(profile);
};
