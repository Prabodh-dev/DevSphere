import Status from "../models/Status.js";
import { uploadToS3 } from "../utils/s3Utils.js";
import { badRequest } from "../utils/httpError.js";
import { requireOneOf, requireString } from "../utils/validate.js";

const STATUS_TYPES = ["text", "image", "video"];

/**
 * POST /api/status
 * Create a new status (text, image, or video)
 */
export const postStatus = async (req, res) => {
  const { type, content } = req.body ?? {};
  const userId = req.user._id;

  if (!type) throw badRequest("Status type is required");
  requireOneOf(type, STATUS_TYPES, "type");

  let finalContent;

  if (type === "text") {
    finalContent = requireString(content, "content", { max: 1000 });
  } else {
    if (!req.file) {
      throw badRequest("File is required for image/video status");
    }
    finalContent = await uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
  }

  const status = await Status.create({
    user: userId,
    type,
    content: finalContent,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hrs
  });

  res.status(201).json({ message: "Status created", status });
};

/**
 * GET /api/status/feed
 * Fetch all active statuses from followed users
 */
export const getStatusFeed = async (req, res) => {
  const user = req.user;
  const followedIds = user.following || [];

  const statuses = await Status.find({
    user: { $in: [...followedIds, user._id] },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .populate("user", "username avatar");

  res.status(200).json({ count: statuses.length, statuses });
};
