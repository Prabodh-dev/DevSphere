import mongoose from "mongoose";
import "../config/mongoose.js";

const userProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    bio: { type: String, maxlength: 300 },
    github: { type: String, maxlength: 200 },
    linkedin: { type: String, maxlength: 200 },
    website: { type: String, maxlength: 200 },
  },
  { timestamps: true }
);

export default mongoose.model("UserProfile", userProfileSchema);
