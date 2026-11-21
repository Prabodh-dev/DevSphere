// routes/presenceRoutes.js
import express from "express";
import { getPresenceOf } from "../controllers/presenceController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import { presenceQuery } from "../schemas/index.js";

const router = express.Router();

// Every route here is limited (the same limiter as the rest of /api).
router.use(limiters.general);

router.get(
  "/",
  authMiddleware,
  validate({ query: presenceQuery }),
  getPresenceOf
);

export default router;
