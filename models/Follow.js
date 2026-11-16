// models/Follow.js
import mongoose from "mongoose";
import "../config/mongoose.js";

// One document per "follower follows following" relationship.
const followSchema = new mongoose.Schema(
  {
    follower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    following: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A pair can exist only once; this also makes following race safe. It serves
// "who does X follow" lookups too.
followSchema.index({ follower: 1, following: 1 }, { unique: true });
// "Who follows X", newest first.
followSchema.index({ following: 1, createdAt: -1 });

followSchema.pre("validate", function () {
  if (this.follower && this.following && this.follower.equals(this.following)) {
    this.invalidate("following", "a user cannot follow themselves");
  }
});

export default mongoose.model("Follow", followSchema);
