import express from "express";
import protect from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  createGroupChat,
  addToGroup,
  removeFromGroup,
  renameGroup,
} from "../controllers/groupController.js";
import {
  createGroupBody,
  groupMemberBody,
  renameGroupBody,
} from "../schemas/index.js";

const router = express.Router();

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

export default router;
