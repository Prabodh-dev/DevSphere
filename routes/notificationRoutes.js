// routes/notificationRoutes.js
import express from "express";
import {
  getNotifications,
  getUnreadCount,
  readAllNotifications,
  readNotification,
} from "../controllers/notificationController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import { notificationIdParams, pageQuery } from "../schemas/index.js";

const router = express.Router();

// Every route here is limited (the same limiter as the rest of /api).
router.use(limiters.general);

router.get(
  "/",
  authMiddleware,
  validate({ query: pageQuery }),
  getNotifications
);
router.get("/unread-count", authMiddleware, getUnreadCount);
router.patch("/read-all", authMiddleware, readAllNotifications);
router.patch(
  "/:id/read",
  authMiddleware,
  validate({ params: notificationIdParams }),
  readNotification
);

export default router;
