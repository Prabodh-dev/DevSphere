// routes/snippetRoutes.js
import express from "express";
import hljs from "highlight.js";

const router = express.Router();

router.post("/highlight", (req, res) => {
  const { code, language } = req.body;

  try {
    const validLang = hljs.getLanguage(language) ? language : "plaintext";
    const highlighted = hljs.highlight(code, { language: validLang }).value;

    res.status(200).json({ highlighted });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Highlighting failed", message: err.message });
  }
});

export default router;
