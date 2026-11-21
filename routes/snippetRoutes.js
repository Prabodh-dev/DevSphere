// routes/snippetRoutes.js
import express from "express";
import {
  createSnippet,
  deleteSnippet,
  getSnippet,
  highlightSnippet,
  listMySnippets,
  listUserSnippets,
  searchSnippets,
  updateSnippet,
} from "../controllers/snippetController.js";
import authMiddleware from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import {
  createSnippetBody,
  highlightBody,
  mySnippetsQuery,
  snippetIdParams,
  snippetListQuery,
  snippetUserParams,
  updateSnippetBody,
} from "../schemas/index.js";

const router = express.Router();

// Every route here is limited (the same limiter as the rest of /api).
router.use(limiters.general);

// Public and rate limited.
router.post(
  "/highlight",
  limiters.highlight,
  validate({ body: highlightBody }),
  highlightSnippet
);

router.post(
  "/",
  authMiddleware,
  validate({ body: createSnippetBody }),
  createSnippet
);
router.get(
  "/",
  authMiddleware,
  validate({ query: snippetListQuery }),
  searchSnippets
);
// Fixed paths come before "/:id".
router.get(
  "/mine",
  authMiddleware,
  validate({ query: mySnippetsQuery }),
  listMySnippets
);
router.get(
  "/user/:userId",
  authMiddleware,
  validate({ params: snippetUserParams, query: snippetListQuery }),
  listUserSnippets
);
router.get(
  "/:id",
  authMiddleware,
  validate({ params: snippetIdParams }),
  getSnippet
);
router.patch(
  "/:id",
  authMiddleware,
  validate({ params: snippetIdParams, body: updateSnippetBody }),
  updateSnippet
);
router.delete(
  "/:id",
  authMiddleware,
  validate({ params: snippetIdParams }),
  deleteSnippet
);

export default router;
