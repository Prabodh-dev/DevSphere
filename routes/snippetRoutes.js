// routes/snippetRoutes.js
import express from "express";
import hljs from "highlight.js";
import { optionalString, requireString } from "../utils/validate.js";

const router = express.Router();

router.post("/highlight", (req, res) => {
  const body = req.body ?? {};
  requireString(body.code, "code", { max: 100000 });
  const code = body.code; // keep the snippet exactly as sent
  const language = optionalString(body.language, "language", { max: 50 });

  const validLang =
    language && hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;

  res.status(200).json({ highlighted });
});

export default router;
