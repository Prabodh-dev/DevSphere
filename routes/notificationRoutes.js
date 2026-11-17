// routes/notificationRoutes.js
import express from "express";
import { getNotifications } from "../controllers/notificationController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import { pageQuery } from "../schemas/index.js";

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  validate({ query: pageQuery }),
  getNotifications
);

export default router;
