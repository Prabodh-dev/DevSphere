// routes/profileRoutes.js
import express from "express";
import {
  createOrUpdateProfile,
  getMyProfile,
  getUserProfileById,
} from "../controllers/profileController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import upload from "../utils/multer.js";

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  upload.single("avatar"),
  createOrUpdateProfile
);
router.post("/", authMiddleware, createOrUpdateProfile);
router.get("/me", authMiddleware, getMyProfile);
router.get("/:userId", getUserProfileById);

export default router;
