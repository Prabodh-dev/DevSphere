import * as notifications from "../services/notificationService.js";
import { notificationView } from "../utils/serializers.js";

export const getNotifications = async (req, res) => {
  const { docs, nextCursor } = await notifications.listNotifications(
    req.user._id,
    req.valid.query
  );
  res
    .status(200)
    .json({ items: await Promise.all(docs.map(notificationView)), nextCursor });
};

export const getUnreadCount = async (req, res) => {
  res
    .status(200)
    .json({ unreadCount: await notifications.unreadCount(req.user._id) });
};

export const readNotification = async (req, res) => {
  const notification = await notifications.markRead(
    req.user._id,
    req.valid.params.id
  );
  res.status(200).json(await notificationView(notification));
};

export const readAllNotifications = async (req, res) => {
  res
    .status(200)
    .json({ updated: await notifications.markAllRead(req.user._id) });
};
