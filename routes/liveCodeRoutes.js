// routes/liveCodeRoutes.js
import express from "express";
import { getLiveCode } from "../controllers/chatController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import { chatIdParams } from "../schemas/index.js";

const router = express.Router();

router.get(
  "/:chatId",
  authMiddleware,
  validate({ params: chatIdParams }),
  getLiveCode
);

export default router;
