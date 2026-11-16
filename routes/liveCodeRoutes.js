// routes/liveCodeRoutes.js
import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import LiveCode from "../models/LiveCode.js";
import { loadChatForMember } from "../utils/chatAccess.js";

const router = express.Router();

router.get("/:chatId", authMiddleware, async (req, res) => {
  const chat = await loadChatForMember(req.params.chatId, req.user._id);
  const codeDoc = await LiveCode.findOne({ chatId: chat._id });
  res.status(200).json(codeDoc);
});

export default router;
