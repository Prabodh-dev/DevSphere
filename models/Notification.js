// models/Notification.js
import mongoose from "mongoose";
import "../config/mongoose.js";

// What a notification is about. `message` and `status` are older kinds that
// the server no longer creates.
export const NOTIFICATION_TYPES = [
  "follow",
  "group",
  "like",
  "reply",
  "mention",
  "message",
  "status",
];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Receiver
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    content: { type: String, maxlength: 500 }, // Optional message
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    // The content the notification is about, so it can be removed with it.
    statusId: { type: mongoose.Schema.Types.ObjectId, ref: "Status" },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    // Notifications that would repeat one another share a key (see
    // notifyUser); a user has at most one notification per key.
    dedupeKey: { type: String, maxlength: 100 },
    seen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
// Unread counts.
notificationSchema.index({ user: 1, seen: 1 });
notificationSchema.index(
  { user: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);
// Removing notifications together with their content.
notificationSchema.index({ statusId: 1 }, { sparse: true });
notificationSchema.index({ messageId: 1 }, { sparse: true });
notificationSchema.index({ chatId: 1 }, { sparse: true });

export default mongoose.model("Notification", notificationSchema);
