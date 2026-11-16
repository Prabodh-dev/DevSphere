// routes/liveCodeRoutes.js
import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import LiveCode from "../models/LiveCode.js";
import { loadChatForMember } from "../utils/chatAccess.js";
import { chatIdParams } from "../schemas/index.js";

const router = express.Router();

router.get(
  "/:chatId",
  authMiddleware,
  validate({ params: chatIdParams }),
  async (req, res) => {
    const chat = await loadChatForMember(req.valid.params.chatId, req.user._id);
    const codeDoc = await LiveCode.findOne({ chatId: chat._id });
    res.status(200).json(codeDoc);
  }
);

export default router;
