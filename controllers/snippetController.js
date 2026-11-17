import { highlight } from "../services/snippetService.js";

export const highlightSnippet = (req, res) => {
  const { code, language } = req.valid.body;
  res.status(200).json({ highlighted: highlight(code, language) });
};
