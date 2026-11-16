// models/Session.js
import mongoose from "mongoose";
import "../config/mongoose.js";

// One document per refresh token. Tokens that belong to the same login share a
// familyId; rotating a token marks it revoked and points replacedBy at its
// successor. Only a SHA-256 hash of the token is stored.
const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    familyId: { type: String, required: true },
    familyStartedAt: { type: Date, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Records are removed once the token has expired.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ familyId: 1, revokedAt: 1 });
sessionSchema.index({ userId: 1, revokedAt: 1 });

export default mongoose.model("Session", sessionSchema);
