// controllers/notificationController.js
import Notification from "../models/Notification.js";

export const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .populate("fromUser", "username avatar")
      .sort({ createdAt: -1 });

    res.status(200).json(notifications);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch notifications", error: err.message });
  }
};

export const createNotification = async (req, res) => {
  try {
    const { user, type, content, fromUser, chatId } = req.body;

    const notification = await Notification.create({
      user,
      type,
      content,
      fromUser,
      chatId,
    });

    res.status(201).json(notification);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to create notification", error: err.message });
  }
};
