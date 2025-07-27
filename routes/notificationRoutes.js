// routes/notificationRoutes.js
import express from "express";
import {
  getNotifications,
  createNotification,
} from "../controllers/notificationController.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, getNotifications);
router.post("/", authMiddleware, createNotification);

export default router;
