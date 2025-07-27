// models/LiveCode.js
import mongoose from "mongoose";

const liveCodeSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    code: { type: String, required: true },
    language: { type: String, default: "plaintext" },
    fileName: { type: String, default: "main" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("LiveCode", liveCodeSchema);
