// models/StatusView.js
import mongoose from "mongoose";
import "../config/mongoose.js";

// One document per user who has viewed a status, so a user counts once.
const statusViewSchema = new mongoose.Schema(
  {
    status: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Status",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Removed together with the status.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

statusViewSchema.index({ status: 1, user: 1 }, { unique: true });
statusViewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("StatusView", statusViewSchema);
