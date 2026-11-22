import hljs from "highlight.js";
import mongoose from "mongoose";
import Snippet from "../models/Snippet.js";
import User from "../models/User.js";
import { notFound } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";

// Highlights code. Unknown or missing languages are shown as plain text.
export function highlight(code, language) {
  const validLang =
    language && hljs.getLanguage(language) ? language : "plaintext";
  return hljs.highlight(code, { language: validLang }).value;
}

const OWNER_FIELDS = "username avatarKey";
const withOwner = (query) => query.populate("owner", OWNER_FIELDS);

const uniqueTags = (tags) => [...new Set(tags)];

export async function createSnippet(ownerId, body) {
  const snippet = await Snippet.create({
    ...body,
    ...(body.tags && { tags: uniqueTags(body.tags) }),
    owner: ownerId,
  });
  return withOwner(Snippet.findById(snippet._id));
}

// A snippet the viewer may read: public ones, and their own. Anything else
// looks like a snippet that does not exist.
async function readableSnippet(id, viewerId) {
  const snippet = await withOwner(Snippet.findById(id));
  const isOwner = snippet?.owner?._id.equals(viewerId);
  if (!snippet || (snippet.visibility !== "public" && !isOwner)) {
    throw notFound("Snippet not found");
  }
  return snippet;
}

export const getSnippet = readableSnippet;

async function ownedSnippet(id, ownerId) {
  const snippet = await Snippet.findById(id);
  // A snippet of someone else is not revealed, even a public one.
  if (!snippet || !snippet.owner.equals(ownerId)) {
    throw notFound("Snippet not found");
  }
  return snippet;
}

export async function updateSnippet(ownerId, id, changes) {
  const snippet = await ownedSnippet(id, ownerId);
  const { tags, ...rest } = changes;
  snippet.set(rest);
  if (tags) snippet.tags = uniqueTags(tags);
  await snippet.save();
  return withOwner(Snippet.findById(snippet._id));
}

export async function deleteSnippet(ownerId, id) {
  const snippet = await ownedSnippet(id, ownerId);
  await snippet.deleteOne();
}

const listFilter = ({ language, tag }) => ({
  ...(language && { language }),
  ...(tag && { tags: tag }),
});

const page = (filter, { limit, cursor }) =>
  paginate(Snippet, {
    filter,
    sortField: "createdAt",
    limit,
    cursor,
    build: withOwner,
  });

// The caller's own snippets, public and private.
export function listMine(ownerId, { limit, cursor, visibility, ...filters }) {
  return page(
    {
      owner: ownerId,
      ...(visibility && { visibility }),
      ...listFilter(filters),
    },
    { limit, cursor }
  );
}

// The public snippets of one user.
export async function listOfUser(userId, { limit, cursor, ...filters }) {
  const user = await User.findById(userId).select("isBlocked");
  if (!user || user.isBlocked) throw notFound("User not found");
  return page(
    { owner: userId, visibility: "public", ...listFilter(filters) },
    { limit, cursor }
  );
}

// Public snippets of everyone, found by tag and/or language.
export async function searchPublic({ limit, cursor, ...filters }) {
  const blocked = await User.distinct("_id", { isBlocked: true });
  return page(
    {
      visibility: "public",
      ...(blocked.length && {
        owner: mongoose.trusted({ $nin: blocked }),
      }),
      ...listFilter(filters),
    },
    { limit, cursor }
  );
}
