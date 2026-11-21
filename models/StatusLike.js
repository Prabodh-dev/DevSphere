// models/StatusLike.js
import mongoose from "mongoose";
import "../config/mongoose.js";

// One document per user who liked a status.
const statusLikeSchema = new mongoose.Schema(
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

// One like per user and status; this also settles simultaneous requests.
statusLikeSchema.index({ status: 1, user: 1 }, { unique: true });
statusLikeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("StatusLike", statusLikeSchema);
