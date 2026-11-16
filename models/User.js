import mongoose from "mongoose";
import "../config/mongoose.js";

const tagsWithinLimits = {
  validator: (tags) =>
    tags.length <= 20 && tags.every((tag) => tag.length <= 30),
  message: "tags: at most 20 tags of up to 30 characters",
};

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    password: { type: String, required: true },
    avatarKey: { type: String, default: "", maxlength: 300 },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isBlocked: { type: Boolean, default: false },
    tags: {
      type: [String],
      index: true,
      default: [],
      validate: tagsWithinLimits,
    },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
