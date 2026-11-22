// models/Snippet.js
import mongoose from "mongoose";
import "../config/mongoose.js";

const tagsWithinLimits = {
  validator: (tags) =>
    tags.length <= 10 && tags.every((tag) => tag.length <= 30),
  message: "tags: at most 10 tags of up to 30 characters",
};

const snippetSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    code: { type: String, required: true, maxlength: 50000 },
    language: { type: String, default: "plaintext", maxlength: 50 },
    tags: { type: [String], default: [], validate: tagsWithinLimits },
    // Private snippets can only be read by their owner.
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "private",
    },
  },
  { timestamps: true }
);

// A user's own snippets, newest first (also filtered by visibility).
snippetSchema.index({ owner: 1, createdAt: -1 });
// Public snippets by tag or language, newest first.
snippetSchema.index({ visibility: 1, tags: 1, createdAt: -1 });
snippetSchema.index({ visibility: 1, language: 1, createdAt: -1 });

export default mongoose.model("Snippet", snippetSchema);
