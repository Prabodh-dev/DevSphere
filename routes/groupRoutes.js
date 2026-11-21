import express from "express";
import protect from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import {
  createGroupChat,
  addToGroup,
  removeFromGroup,
  renameGroup,
  leaveGroup,
  promoteMember,
  demoteMember,
  deleteGroup,
} from "../controllers/groupController.js";
import {
  chatIdParams,
  createGroupBody,
  groupChatBody,
  groupMemberBody,
  renameGroupBody,
} from "../schemas/index.js";

const router = express.Router();

// Every route here is limited (the same limiter as the rest of /api).
router.use(limiters.general);

router.post(
  "/create",
  protect,
  validate({ body: createGroupBody }),
  createGroupChat
);
router.patch("/add", protect, validate({ body: groupMemberBody }), addToGroup);
router.patch(
  "/remove",
  protect,
  validate({ body: groupMemberBody }),
  removeFromGroup
);
router.patch(
  "/rename",
  protect,
  validate({ body: renameGroupBody }),
  renameGroup
);

router.patch("/leave", protect, validate({ body: groupChatBody }), leaveGroup);
router.patch(
  "/promote",
  protect,
  validate({ body: groupMemberBody }),
  promoteMember
);
router.patch(
  "/demote",
  protect,
  validate({ body: groupMemberBody }),
  demoteMember
);
router.delete(
  "/:chatId",
  protect,
  validate({ params: chatIdParams }),
  deleteGroup
);

export default router;
