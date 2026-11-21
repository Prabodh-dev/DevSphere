import express from "express";
import {
  deleteStatus,
  getReplies,
  getStatus,
  getStatusFeed,
  likeStatus,
  postStatus,
  replyToStatus,
  unlikeStatus,
  viewStatus,
} from "../controllers/statusController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import { uploadStatusMedia } from "../utils/multer.js";
import {
  pageQuery,
  statusBody,
  statusIdParams,
  statusReplyBody,
} from "../schemas/index.js";

const router = express.Router();

// Every route here is limited (the same limiter as the rest of /api).
router.use(limiters.general);

router.post(
  "/",
  authMiddleware,
  uploadStatusMedia.single("media"),
  validate({ body: statusBody }),
  postStatus
);
router.get(
  "/feed",
  authMiddleware,
  validate({ query: pageQuery }),
  getStatusFeed
);
router.get(
  "/:id",
  authMiddleware,
  validate({ params: statusIdParams }),
  getStatus
);
router.delete(
  "/:id",
  authMiddleware,
  validate({ params: statusIdParams }),
  deleteStatus
);
router.put(
  "/:id/like",
  authMiddleware,
  validate({ params: statusIdParams }),
  likeStatus
);
router.delete(
  "/:id/like",
  authMiddleware,
  validate({ params: statusIdParams }),
  unlikeStatus
);
router.post(
  "/:id/replies",
  authMiddleware,
  validate({ params: statusIdParams, body: statusReplyBody }),
  replyToStatus
);
router.get(
  "/:id/replies",
  authMiddleware,
  validate({ params: statusIdParams, query: pageQuery }),
  getReplies
);
router.post(
  "/:id/view",
  authMiddleware,
  validate({ params: statusIdParams }),
  viewStatus
);

export default router;
