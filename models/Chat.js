// models/Chat.js

import mongoose from "mongoose";
import "../config/mongoose.js";

const chatSchema = new mongoose.Schema(
  {
    isGroupChat: {
      type: Boolean,
      default: false,
    },
    chatName: {
      type: String,
      trim: true,
      maxlength: 100,
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
      default: "", // Optional image for the group
      maxlength: 300,
    },
  },
  { timestamps: true }
);

chatSchema.index({ members: 1 });

export default mongoose.model("Chat", chatSchema);
