import express from "express";
import { postStatus, getStatusFeed } from "../controllers/statusController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import { uploadStatusMedia } from "../utils/multer.js";
import { statusBody } from "../schemas/index.js";

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  uploadStatusMedia.single("media"),
  validate({ body: statusBody }),
  postStatus
);
router.get("/feed", authMiddleware, getStatusFeed);

export default router;
