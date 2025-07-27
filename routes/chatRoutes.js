import express from "express";
import {
  accessChat,
  fetchChats,
  sendMessage,
  getMessages,
} from "../controllers/messageController.js";
import authMiddleware from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/access", authMiddleware, accessChat);
router.get("/", authMiddleware, fetchChats);
router.post("/message", authMiddleware, sendMessage);
router.get("/message/:chatId", authMiddleware, getMessages);

export default router;
