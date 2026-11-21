import express from "express";
import {
  accessChat,
  fetchChats,
  sendMessage,
  getMessages,
  markRead,
  sendMedia,
} from "../controllers/chatController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import { uploadChatMedia } from "../utils/multer.js";
import {
  accessChatBody,
  chatIdParams,
  markReadBody,
  mediaMessageBody,
  pageQuery,
  sendMessageBody,
} from "../schemas/index.js";

const router = express.Router();

// Every route here is limited (the same limiter as the rest of /api).
router.use(limiters.general);

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
router.post(
  "/media",
  authMiddleware,
  uploadChatMedia,
  validate({ body: mediaMessageBody }),
  sendMedia
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
