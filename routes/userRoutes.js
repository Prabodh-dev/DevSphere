import express from "express";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  updateTags,
  searchUsersByTag,
} from "../controllers/userController.js";
import protect from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  pageQuery,
  tagQuery,
  tagsBody,
  userIdParams,
} from "../schemas/index.js";

const router = express.Router();

const withId = validate({ params: userIdParams });

router.post("/:id/follow", protect, withId, followUser);
router.post("/:id/unfollow", protect, withId, unfollowUser);
router.patch("/me/tags", protect, validate({ body: tagsBody }), updateTags);
router.get(
  "/:id/followers",
  protect,
  validate({ params: userIdParams, query: pageQuery }),
  getFollowers
);
router.get(
  "/:id/following",
  protect,
  validate({ params: userIdParams, query: pageQuery }),
  getFollowing
);
router.get("/", protect, validate({ query: tagQuery }), searchUsersByTag);

export default router;
