// models/Status.js
import mongoose from "mongoose";

const statusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["image", "video", "text"], required: true },
    content: { type: String, required: true }, // URL or text
    expiresAt: { type: Date, required: true }, // TTL auto-delete
  },
  { timestamps: true }
);

// TTL: Auto-delete after 24 hrs
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Status", statusSchema);
