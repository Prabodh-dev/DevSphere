// controllers/notificationController.js
import Notification from "../models/Notification.js";
import { notificationView } from "../utils/notify.js";
import { paginate } from "../utils/pagination.js";

export const getNotifications = async (req, res) => {
  const { limit, cursor } = req.valid.query;

  const { docs, nextCursor } = await paginate(Notification, {
    filter: { user: req.user._id },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("fromUser", "username avatarKey"),
  });

  res
    .status(200)
    .json({ items: await Promise.all(docs.map(notificationView)), nextCursor });
};
