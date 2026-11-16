// controllers/notificationController.js
import Notification from "../models/Notification.js";
export const getNotifications = async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .populate("fromUser", "username avatar")
    .sort({ createdAt: -1 });

  res.status(200).json(notifications);
};
