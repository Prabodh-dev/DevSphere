// models/LiveCode.js
import mongoose from "mongoose";
import "../config/mongoose.js";

const liveCodeSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    code: { type: String, required: true },
    language: { type: String, default: "plaintext", maxlength: 50 },
    fileName: { type: String, default: "main", maxlength: 100 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("LiveCode", liveCodeSchema);
