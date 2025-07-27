// models/Notification.js
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Receiver
    type: {
      type: String,
      enum: ["message", "follow", "group", "status"],
      required: true,
    },
    content: { type: String }, // Optional message
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    seen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);
