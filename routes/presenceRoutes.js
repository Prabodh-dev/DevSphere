// routes/presenceRoutes.js
import express from "express";
import { getPresenceOf } from "../controllers/presenceController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import { presenceQuery } from "../schemas/index.js";

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  validate({ query: presenceQuery }),
  getPresenceOf
);

export default router;
