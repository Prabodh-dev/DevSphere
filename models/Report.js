// models/Report.js
import mongoose from "mongoose";
import "../config/mongoose.js";

const reportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetType: {
      type: String,
      enum: ["message", "status", "user"],
      required: true,
    },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["open", "resolved"], default: "open" },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

reportSchema.index({ targetType: 1, targetId: 1 });
reportSchema.index({ createdAt: -1 });
// One open report per user and target. This also settles simultaneous requests.
reportSchema.index(
  { reportedBy: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: "open" } }
);

export default mongoose.model("Report", reportSchema);
