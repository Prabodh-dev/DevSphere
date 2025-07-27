import express from "express";
import protect from "../middlewares/authMiddleware.js";
import {
  createGroupChat,
  addToGroup,
  removeFromGroup,
  renameGroup,
} from "../controllers/chatController.js";

const router = express.Router();

router.post("/create", protect, createGroupChat);
router.patch("/add", protect, addToGroup);
router.patch("/remove", protect, removeFromGroup);
router.patch("/rename", protect, renameGroup);

export default router;
