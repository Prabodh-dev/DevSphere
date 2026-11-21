// models/StatusReply.js
import mongoose from "mongoose";
import "../config/mongoose.js";

const statusReplySchema = new mongoose.Schema(
  {
    status: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Status",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    // Removed together with the status.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A status's replies in order.
statusReplySchema.index({ status: 1, createdAt: 1 });
statusReplySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("StatusReply", statusReplySchema);
