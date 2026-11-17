import Notification from "../models/Notification.js";
import { notificationView } from "../utils/serializers.js";
import { paginate } from "../utils/pagination.js";
import { userRoom } from "../utils/rooms.js";

// Creates a notification and pushes it to the recipient's open sockets.
// Failures are logged: a missed notification must not fail the request.
export async function notifyUser(
  io,
  { userId, type, content, fromUser, chatId }
) {
  try {
    const created = await Notification.create({
      user: userId,
      type,
      content,
      fromUser,
      chatId,
    });
    const notification = await created.populate(
      "fromUser",
      "username avatarKey"
    );
    io?.to(userRoom(userId)).emit(
      "receive-notification",
      await notificationView(notification)
    );
  } catch (err) {
    console.warn("Could not create notification:", err.message);
  }
}

// A user's notifications, newest first.
export function listNotifications(userId, { limit, cursor }) {
  return paginate(Notification, {
    filter: { user: userId },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("fromUser", "username avatarKey"),
  });
}
