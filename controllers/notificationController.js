// controllers/notificationController.js
import Notification from "../models/Notification.js";
import { notificationView } from "../utils/notify.js";

export const getNotifications = async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .populate("fromUser", "username avatarKey")
    .sort({ createdAt: -1 });

  res.status(200).json(await Promise.all(notifications.map(notificationView)));
};
