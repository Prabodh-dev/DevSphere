import mongoose from "mongoose";
import Status from "../models/Status.js";
import { badRequest } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";
import { uploadMedia } from "../utils/s3Utils.js";
import { followedIds } from "./followService.js";

const VISIBLE_FOR_MS = 24 * 60 * 60 * 1000;
// The record is kept a little longer than it is visible so its stored file
// can be cleaned up before the TTL index removes it.
const RECORD_GRACE_MS = 60 * 60 * 1000;

// Creates a text, image or video status. file is the uploaded file, if any.
export async function createStatus(userId, { type, content }, file) {
  const data = { user: userId, type };

  if (type === "text") {
    data.content = content;
  } else {
    if (!file) throw badRequest("File is required for image/video status");

    const expectsImage = type === "image";
    if (file.mimetype.startsWith("image/") !== expectsImage) {
      throw badRequest("File does not match the status type");
    }
    data.mediaKey = await uploadMedia({
      buffer: file.buffer,
      mimetype: file.mimetype,
      prefix: "status",
    });
  }

  const visibleUntil = new Date(Date.now() + VISIBLE_FOR_MS);
  data.visibleUntil = visibleUntil;
  data.expiresAt = new Date(visibleUntil.getTime() + RECORD_GRACE_MS);

  return Status.create(data);
}

// Active statuses from the user and the people they follow, newest first.
export async function getFeed(userId, { limit, cursor }) {
  const followed = await followedIds(userId);
  const now = new Date();

  return paginate(Status, {
    filter: {
      user: mongoose.trusted({ $in: [...followed, userId] }),
      // Records created before visibleUntil existed only have expiresAt.
      $or: [
        { visibleUntil: mongoose.trusted({ $gt: now }) },
        {
          visibleUntil: mongoose.trusted({ $exists: false }),
          expiresAt: mongoose.trusted({ $gt: now }),
        },
      ],
    },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("user", "username avatarKey"),
  });
}
