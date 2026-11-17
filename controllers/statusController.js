import mongoose from "mongoose";
import Status from "../models/Status.js";
import { uploadMedia } from "../utils/s3Utils.js";
import { badRequest } from "../utils/httpError.js";
import { statusView } from "../utils/serializers.js";
import { followedIds } from "../utils/follows.js";

const VISIBLE_FOR_MS = 24 * 60 * 60 * 1000;
// The record is kept a little longer than it is visible so its stored file
// can be cleaned up before the TTL index removes it.
const RECORD_GRACE_MS = 60 * 60 * 1000;

/**
 * POST /api/v1/status
 * Create a new status (text, image, or video)
 */
export const postStatus = async (req, res) => {
  const { type, content } = req.valid.body;

  const data = { user: req.user._id, type };

  if (type === "text") {
    data.content = content;
  } else {
    if (!req.file) {
      throw badRequest("File is required for image/video status");
    }
    const expectsImage = type === "image";
    if (req.file.mimetype.startsWith("image/") !== expectsImage) {
      throw badRequest("File does not match the status type");
    }
    data.mediaKey = await uploadMedia({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      prefix: "status",
    });
  }

  const visibleUntil = new Date(Date.now() + VISIBLE_FOR_MS);
  data.visibleUntil = visibleUntil;
  data.expiresAt = new Date(visibleUntil.getTime() + RECORD_GRACE_MS);

  const status = await Status.create(data);

  res
    .status(201)
    .json({ message: "Status created", status: await statusView(status) });
};

/**
 * GET /api/v1/status/feed
 * Fetch all active statuses from followed users
 */
export const getStatusFeed = async (req, res) => {
  const user = req.user;
  const followed = await followedIds(user._id);
  const now = new Date();

  const statuses = await Status.find({
    user: mongoose.trusted({ $in: [...followed, user._id] }),
    // Records created before visibleUntil existed only have expiresAt.
    $or: [
      { visibleUntil: mongoose.trusted({ $gt: now }) },
      {
        visibleUntil: mongoose.trusted({ $exists: false }),
        expiresAt: mongoose.trusted({ $gt: now }),
      },
    ],
  })
    .sort({ createdAt: -1 })
    .populate("user", "username avatarKey");

  res.status(200).json({
    count: statuses.length,
    statuses: await Promise.all(statuses.map(statusView)),
  });
};
