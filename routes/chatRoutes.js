import express from "express";
import {
  accessChat,
  fetchChats,
  sendMessage,
  getMessages,
  markRead,
} from "../controllers/chatController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  accessChatBody,
  chatIdParams,
  markReadBody,
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

router.put(
  "/:chatId/read",
  authMiddleware,
  validate({ params: chatIdParams, body: markReadBody }),
  markRead
);

export default router;
