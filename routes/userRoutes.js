import express from "express";
import { followUser, unfollowUser } from "../controllers/userController.js";
import protect from "../middlewares/authMiddleware.js";
import { getFollowers, getFollowing } from "../controllers/userController.js";
import { updateTags } from "../controllers/userController.js";
import { searchUsersByTag } from "../controllers/userController.js";
const router = express.Router();

// Follow a user
router.post("/:id/follow", protect, followUser);
// Unfollow a user
router.post("/:id/unfollow", protect, unfollowUser);
router.patch("/me/tags", protect, updateTags);
router.get("/:id/followers", protect, getFollowers);
router.get("/:id/following", protect, getFollowing);
router.get("/", protect, searchUsersByTag);
export default router;
