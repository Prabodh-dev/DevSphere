// routes/profileRoutes.js
import express from "express";
import {
  createOrUpdateProfile,
  getMyProfile,
  getUserProfileById,
} from "../controllers/profileController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import upload from "../utils/multer.js";
import { profileBody, profileParams } from "../schemas/index.js";

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  upload.single("avatar"),
  validate({ body: profileBody }),
  createOrUpdateProfile
);
router.get("/me", authMiddleware, getMyProfile);
router.get("/:userId", validate({ params: profileParams }), getUserProfileById);

export default router;
