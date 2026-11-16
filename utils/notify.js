import Notification from "../models/Notification.js";
import { publicUserView } from "./serializers.js";
import { userRoom } from "./rooms.js";

export const notificationView = async (notification) => {
  const plain = notification.toObject();
  if (plain.fromUser && plain.fromUser.username !== undefined) {
    plain.fromUser = await publicUserView(plain.fromUser);
  }
  return plain;
};

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
