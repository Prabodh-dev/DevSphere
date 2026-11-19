// models/ChatRead.js
import mongoose from "mongoose";
import "../config/mongoose.js";

// How far a member has read a chat: one document per member and chat.
const chatReadSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastReadMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    // The createdAt of that message, so "forward" can be decided without
    // loading it.
    lastReadAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// One marker per member and chat; also makes the first write race safe.
chatReadSchema.index({ chat: 1, user: 1 }, { unique: true });
// A member's markers, for the chat list.
chatReadSchema.index({ user: 1, chat: 1 });

export default mongoose.model("ChatRead", chatReadSchema);
