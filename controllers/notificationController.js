// controllers/notificationController.js
import Notification from "../models/Notification.js";
import { badRequest } from "../utils/httpError.js";
import {
  optionalString,
  requireObjectId,
  requireOneOf,
} from "../utils/validate.js";

const NOTIFICATION_TYPES = ["message", "follow", "group", "status"];

export const getNotifications = async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .populate("fromUser", "username avatar")
    .sort({ createdAt: -1 });

  res.status(200).json(notifications);
};

export const createNotification = async (req, res) => {
  const body = req.body ?? {};
  if (typeof body !== "object") throw badRequest("Invalid body");

  const data = {
    user: requireObjectId(body.user, "user"),
    type: requireOneOf(body.type, NOTIFICATION_TYPES, "type"),
    content: optionalString(body.content, "content", { max: 500 }),
  };
  if (body.fromUser !== undefined) {
    data.fromUser = requireObjectId(body.fromUser, "fromUser");
  }
  if (body.chatId !== undefined) {
    data.chatId = requireObjectId(body.chatId, "chatId");
  }

  const notification = await Notification.create(data);

  res.status(201).json(notification);
};
