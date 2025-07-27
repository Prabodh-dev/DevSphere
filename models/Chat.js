// models/Chat.js

import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    isGroupChat: {
      type: Boolean,
      default: false,
    },
    chatName: {
      type: String,
      trim: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    latestMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    groupAvatar: {
      type: String,
      default: "", // Optional: Cloudinary/S3 image for group avatar
    },
  },
  { timestamps: true }
);

export default mongoose.model("Chat", chatSchema);
