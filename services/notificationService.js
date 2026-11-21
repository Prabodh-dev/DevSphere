import Notification from "../models/Notification.js";
import { notFound } from "../utils/httpError.js";
import { notificationView } from "../utils/serializers.js";
import { paginate } from "../utils/pagination.js";
import { logger } from "../utils/logger.js";
import { userRoom } from "../utils/rooms.js";

const FROM_USER_FIELDS = "username avatarKey";

// Creates a notification and pushes it to the recipient's open sockets.
//
// - Nobody is notified about their own actions.
// - With a dedupeKey, a notification that already exists for the recipient is
//   not created again (a repeated like or follow), and nothing is pushed.
// - Failures are logged: a missed notification must not fail the request.
//
// Returns the created notification, or null.
export async function notifyUser(
  io,
  { userId, type, content, fromUser, chatId, statusId, messageId, dedupeKey }
) {
  if (fromUser && String(fromUser) === String(userId)) return null;

  try {
    const created = await Notification.create({
      user: userId,
      type,
      content,
      fromUser,
      chatId,
      statusId,
      messageId,
      dedupeKey,
    });
    const notification = await created.populate("fromUser", FROM_USER_FIELDS);
    io?.to(userRoom(userId)).emit(
      "receive-notification",
      await notificationView(notification)
    );
    return notification;
  } catch (err) {
    // The unique index decided: this one is already there.
    if (err.code === 11000) return null;
    logger.warn({ err: err.message }, "Could not create notification");
    return null;
  }
}

// Removes the notifications about content that no longer exists: those that
// point at a status, a message or a chat.
export async function removeNotificationsFor({ statusId, messageId, chatId }) {
  const filter = {
    ...(statusId && { statusId }),
    ...(messageId && { messageId }),
    ...(chatId && { chatId }),
  };
  if (!Object.keys(filter).length) {
    throw new Error(
      "removeNotificationsFor needs a statusId, messageId or chatId"
    );
  }
  return (await Notification.deleteMany(filter)).deletedCount;
}

// A user's notifications, newest first.
export function listNotifications(userId, { limit, cursor }) {
  return paginate(Notification, {
    filter: { user: userId },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("fromUser", FROM_USER_FIELDS),
  });
}

export const unreadCount = (userId) =>
  Notification.countDocuments({ user: userId, seen: false });

// Marking something read twice is harmless. Other people's notifications look
// like notifications that do not exist.
export async function markRead(userId, id) {
  const notification = await Notification.findOneAndUpdate(
    { _id: id, user: userId },
    { seen: true },
    { returnDocument: "after" }
  ).populate("fromUser", FROM_USER_FIELDS);
  if (!notification) throw notFound("Notification not found");
  return notification;
}

export async function markAllRead(userId) {
  const result = await Notification.updateMany(
    { user: userId, seen: false },
    { seen: true }
  );
  return result.modifiedCount;
}
