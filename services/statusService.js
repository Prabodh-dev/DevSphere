import mongoose from "mongoose";
import Follow from "../models/Follow.js";
import Notification from "../models/Notification.js";
import Status from "../models/Status.js";
import StatusLike from "../models/StatusLike.js";
import StatusReply from "../models/StatusReply.js";
import StatusView from "../models/StatusView.js";
import User from "../models/User.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";
import { deleteMedia, uploadMedia } from "../utils/s3Utils.js";
import { followedIds } from "./followService.js";
import {
  notifyUser,
  removeNotificationByKey,
  removeNotificationsFor,
} from "./notificationService.js";

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

// Statuses that are still in their viewing window. Records created before
// visibleUntil existed only have expiresAt.
const activeFilter = () => {
  const now = new Date();
  return {
    $or: [
      { visibleUntil: mongoose.trusted({ $gt: now }) },
      {
        visibleUntil: mongoose.trusted({ $exists: false }),
        expiresAt: mongoose.trusted({ $gt: now }),
      },
    ],
  };
};

// Which of these statuses the user has liked, as a Set of status ids.
export async function likedSet(userId, statusIds) {
  if (!statusIds.length) return new Set();
  const likes = await StatusLike.find({
    user: userId,
    status: mongoose.trusted({ $in: statusIds }),
  }).select("status");
  return new Set(likes.map((like) => like.status.toString()));
}

// Active statuses from the user and the people they follow, newest first.
// Statuses of blocked accounts are left out.
export async function getFeed(userId, { limit, cursor }) {
  const followed = await followedIds(userId);
  const authors = await User.find({
    _id: mongoose.trusted({ $in: [...followed, userId] }),
    isBlocked: false,
  }).select("_id");

  const page = await paginate(Status, {
    filter: {
      user: mongoose.trusted({ $in: authors.map((a) => a._id) }),
      ...activeFilter(),
    },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("user", "username avatarKey"),
  });
  const liked = await likedSet(
    userId,
    page.docs.map((status) => status._id)
  );
  return { ...page, liked };
}

// A status the viewer may see: an active one from themselves or someone they
// follow, whose account is not blocked. Anything else looks like a status that
// does not exist.
export async function loadVisibleStatus(statusId, viewerId) {
  const status = await Status.findOne({
    _id: statusId,
    ...activeFilter(),
  }).populate("user", "username avatarKey isBlocked");
  if (!status || status.user?.isBlocked) throw notFound("Status not found");

  const isOwner = status.user._id.equals(viewerId);
  if (
    !isOwner &&
    !(await Follow.exists({ follower: viewerId, following: status.user._id }))
  ) {
    throw notFound("Status not found");
  }
  return status;
}

export async function getStatus(viewerId, statusId) {
  const status = await loadVisibleStatus(statusId, viewerId);
  const liked = await likedSet(viewerId, [status._id]);
  return { status, likedByMe: liked.has(status.id) };
}

// Likes a status. Liking again changes nothing. The owner is told once.
export async function likeStatus(actor, statusId, io) {
  const status = await loadVisibleStatus(statusId, actor._id);

  try {
    await StatusLike.create({
      status: status._id,
      user: actor._id,
      expiresAt: status.expiresAt,
    });
    await Status.updateOne({ _id: status._id }, { $inc: { likeCount: 1 } });
    await notifyUser(io, {
      userId: status.user._id,
      type: "like",
      content: `${actor.username} liked your status`,
      fromUser: actor._id,
      statusId: status._id,
      dedupeKey: `like:${status._id}:${actor._id}`,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return Status.findById(status._id).select("likeCount");
}

// Taking a like back is harmless when there is none, and also takes back the
// notification.
export async function unlikeStatus(actor, statusId) {
  const status = await loadVisibleStatus(statusId, actor._id);

  const removed = await StatusLike.deleteOne({
    status: status._id,
    user: actor._id,
  });
  if (removed.deletedCount) {
    await Status.updateOne({ _id: status._id }, { $inc: { likeCount: -1 } });
    await removeNotificationByKey(
      status.user._id,
      `like:${status._id}:${actor._id}`
    );
  }
  return Status.findById(status._id).select("likeCount");
}

export async function replyToStatus(actor, statusId, { text }, io) {
  const status = await loadVisibleStatus(statusId, actor._id);

  const reply = await StatusReply.create({
    status: status._id,
    user: actor._id,
    text,
    expiresAt: status.expiresAt,
  });
  await Status.updateOne({ _id: status._id }, { $inc: { replyCount: 1 } });
  await notifyUser(io, {
    userId: status.user._id,
    type: "reply",
    content: `${actor.username} replied to your status`,
    fromUser: actor._id,
    statusId: status._id,
    dedupeKey: `reply:${reply._id}`,
  });
  return reply.populate("user", "username avatarKey");
}

// Replies in the order they were written. Replies of blocked accounts are
// left out.
export async function listReplies(viewerId, statusId, { limit, cursor }) {
  const status = await loadVisibleStatus(statusId, viewerId);
  const blocked = await User.distinct("_id", { isBlocked: true });

  return paginate(StatusReply, {
    filter: {
      status: status._id,
      ...(blocked.length && { user: mongoose.trusted({ $nin: blocked }) }),
    },
    sortField: "createdAt",
    direction: 1,
    limit,
    cursor,
    build: (query) => query.populate("user", "username avatarKey"),
  });
}

// Counts a view once per user. The owner looking at their own status does not
// count.
export async function recordView(viewerId, statusId) {
  const status = await loadVisibleStatus(statusId, viewerId);

  if (!status.user._id.equals(viewerId)) {
    try {
      await StatusView.create({
        status: status._id,
        user: viewerId,
        expiresAt: status.expiresAt,
      });
      await Status.updateOne({ _id: status._id }, { $inc: { viewCount: 1 } });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return Status.findById(status._id).select("viewCount");
}

// Removes a status with everything that hangs on it: its stored file, likes,
// replies, views and the notifications about it.
export async function removeStatus(status) {
  await deleteMedia(status.mediaKey);
  await Promise.all([
    StatusLike.deleteMany({ status: status._id }),
    StatusReply.deleteMany({ status: status._id }),
    StatusView.deleteMany({ status: status._id }),
    removeNotificationsFor({ statusId: status._id }),
  ]);
  await Status.deleteOne({ _id: status._id });
}

// Only the owner can delete a status; to everyone else it does not exist.
export async function deleteOwnStatus(userId, statusId) {
  const status = await Status.findOne({ _id: statusId, user: userId });
  if (!status) throw notFound("Status not found");
  await removeStatus(status);
}

// Notifications about statuses that have expired (the TTL index removed them
// and their likes, replies and views) are no longer useful.
export async function removeNotificationsOfMissingStatuses() {
  const ids = await Notification.distinct("statusId", {
    statusId: mongoose.trusted({ $exists: true, $ne: null }),
  });
  if (!ids.length) return 0;
  const present = new Set(
    (
      await Status.find({ _id: mongoose.trusted({ $in: ids }) }).select("_id")
    ).map((status) => status.id)
  );
  const missing = ids.filter((id) => !present.has(id.toString()));
  if (!missing.length) return 0;
  const result = await Notification.deleteMany({
    statusId: mongoose.trusted({ $in: missing }),
  });
  return result.deletedCount;
}
