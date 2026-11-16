// models/Message.js

import mongoose from "mongoose";
import "../config/mongoose.js";

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, maxlength: 5000 },
    type: {
      type: String,
      enum: ["text", "media", "code"],
      default: "text",
    },
    code: {
      language: { type: String, maxlength: 50 },
      content: { type: String, maxlength: 100000 },
    },
  },
  { timestamps: true }
);

// Code messages carry code, every other kind carries text.
messageSchema.pre("validate", function () {
  if (this.type === "code") {
    if (!this.code?.content) {
      this.invalidate("code.content", "code.content is required");
    }
  } else if (!this.text) {
    this.invalidate("text", "text is required");
  }
});

export default mongoose.model("Message", messageSchema);
