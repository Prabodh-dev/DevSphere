import express from "express";
import {
  accessChat,
  fetchChats,
  sendMessage,
  getMessages,
} from "../controllers/messageController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  accessChatBody,
  chatIdParams,
  pageQuery,
  sendMessageBody,
} from "../schemas/index.js";

const router = express.Router();

router.post(
  "/access",
  authMiddleware,
  validate({ body: accessChatBody }),
  accessChat
);
router.get("/", authMiddleware, validate({ query: pageQuery }), fetchChats);
router.post(
  "/message",
  authMiddleware,
  validate({ body: sendMessageBody }),
  sendMessage
);
router.get(
  "/message/:chatId",
  authMiddleware,
  validate({ params: chatIdParams, query: pageQuery }),
  getMessages
);

export default router;
