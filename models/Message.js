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
    // For media messages: what was stored. Only the key is private; clients
    // get a signed link instead of it.
    media: {
      mimeType: { type: String, maxlength: 100 },
      key: { type: String, maxlength: 300 },
      size: { type: Number, min: 0 },
      fileName: { type: String, maxlength: 255 },
    },
    code: {
      language: { type: String, maxlength: 50 },
      content: { type: String, maxlength: 100000 },
    },
  },
  { timestamps: true }
);

messageSchema.index({ chat: 1, createdAt: -1 });

// Code messages carry code, media messages a stored file, every other kind
// carries text.
messageSchema.pre("validate", function () {
  if (this.type === "media") {
    if (!this.media?.key) this.invalidate("media.key", "media.key is required");
  } else if (this.type === "code") {
    if (!this.code?.content) {
      this.invalidate("code.content", "code.content is required");
    }
  } else if (!this.text) {
    this.invalidate("text", "text is required");
  }
});

export default mongoose.model("Message", messageSchema);
