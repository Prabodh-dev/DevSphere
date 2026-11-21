import * as snippets from "../services/snippetService.js";
import { snippetView } from "../utils/serializers.js";

export const highlightSnippet = (req, res) => {
  const { code, language } = req.valid.body;
  res.status(200).json({ highlighted: snippets.highlight(code, language) });
};

const list = (fetch) => async (req, res) => {
  const { docs, nextCursor } = await fetch(req);
  res
    .status(200)
    .json({ items: await Promise.all(docs.map(snippetView)), nextCursor });
};

export const createSnippet = async (req, res) => {
  const snippet = await snippets.createSnippet(req.user._id, req.valid.body);
  res.status(201).json(await snippetView(snippet));
};

export const getSnippet = async (req, res) => {
  const snippet = await snippets.getSnippet(req.valid.params.id, req.user._id);
  res.status(200).json(await snippetView(snippet));
};

export const updateSnippet = async (req, res) => {
  const snippet = await snippets.updateSnippet(
    req.user._id,
    req.valid.params.id,
    req.valid.body
  );
  res.status(200).json(await snippetView(snippet));
};

export const deleteSnippet = async (req, res) => {
  await snippets.deleteSnippet(req.user._id, req.valid.params.id);
  res.status(200).json({ message: "Snippet deleted" });
};

export const listMySnippets = list((req) =>
  snippets.listMine(req.user._id, req.valid.query)
);
export const listUserSnippets = list((req) =>
  snippets.listOfUser(req.valid.params.userId, req.valid.query)
);
export const searchSnippets = list((req) =>
  snippets.searchPublic(req.valid.query)
);
