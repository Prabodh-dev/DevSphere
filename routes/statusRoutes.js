import express from "express";
import { postStatus, getStatusFeed } from "../controllers/statusController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import upload from "../utils/multer.js";

const router = express.Router();

router.post("/", authMiddleware, upload.single("media"), postStatus);
router.get("/feed", authMiddleware, getStatusFeed);

export default router;
