// models/Status.js
import mongoose from "mongoose";
import "../config/mongoose.js";

const statusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["image", "video", "text"], required: true },
    // Text statuses keep their text here; media statuses keep it in mediaKey.
    content: {
      type: String,
      required: function () {
        return this.type === "text";
      },
    },
    mediaKey: { type: String },
    // End of the 24 hour viewing window. expiresAt (below) is when the record
    // itself is removed, a little later, so stored files can be cleaned up first.
    visibleUntil: { type: Date },
    expiresAt: { type: Date, required: true }, // TTL auto-delete
  },
  { timestamps: true }
);

// TTL: the record is removed once expiresAt has passed.
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Status", statusSchema);
