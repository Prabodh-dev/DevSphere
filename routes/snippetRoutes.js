// routes/snippetRoutes.js
import express from "express";
import { highlightSnippet } from "../controllers/snippetController.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import { highlightBody } from "../schemas/index.js";

const router = express.Router();

router.post(
  "/highlight",
  limiters.highlight,
  validate({ body: highlightBody }),
  highlightSnippet
);

export default router;
