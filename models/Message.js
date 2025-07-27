// models/Message.js

import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String },
    type: {
      type: String,
      enum: ["text", "media", "code"],
      default: "text",
    },
    code: {
      language: { type: String },
      content: { type: String },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);
