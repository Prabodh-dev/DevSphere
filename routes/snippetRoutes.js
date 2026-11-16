// routes/snippetRoutes.js
import express from "express";
import hljs from "highlight.js";
import validate from "../middlewares/validate.js";
import { highlightBody } from "../schemas/index.js";

const router = express.Router();

router.post("/highlight", validate({ body: highlightBody }), (req, res) => {
  const { code, language } = req.valid.body;

  const validLang =
    language && hljs.getLanguage(language) ? language : "plaintext";
  const highlighted = hljs.highlight(code, { language: validLang }).value;

  res.status(200).json({ highlighted });
});

export default router;
