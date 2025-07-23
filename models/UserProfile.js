import mongoose from "mongoose";

const userProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    avatar: { type: String },
    bio: { type: String, maxlength: 300 },
    github: { type: String },
    linkedin: { type: String },
    website: { type: String },
    tags: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model("UserProfile", userProfileSchema);
