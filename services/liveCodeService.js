import mongoose from "mongoose";
import LiveCode from "../models/LiveCode.js";
import { config } from "../config/index.js";
import { getRedisClient } from "../config/redis.js";
import { logger } from "../utils/logger.js";

// Live code documents are edited many times a second, so the current version
// lives in a "working copy" (in Redis when available, so every app instance
// agrees, otherwise in memory) and is written to MongoDB a little later.
//
// Every accepted edit raises the revision by one. An edit names the revision it
// was made on; if the document has moved on, the edit is refused and the
// current document is returned, so nothing is silently overwritten.

const WORKING_COPY_SECONDS = 60 * 60;
// Continuous typing is still saved at least this many flush delays apart.
const MAX_WAIT_FACTOR = 5;

const blank = () => ({
  code: "",
  language: "plaintext",
  fileName: "main",
  revision: 0,
  updatedBy: null,
});

const toDocument = (doc) => ({
  code: doc.code,
  language: doc.language,
  fileName: doc.fileName,
  revision: Number(doc.revision ?? 0),
  updatedBy: doc.updatedBy ? String(doc.updatedBy) : null,
});

// ---- working copies in memory ----
class MemoryCopies {
  constructor() {
    this.docs = new Map();
  }
  async get(chatId) {
    const doc = this.docs.get(chatId);
    return doc ? { ...doc } : null;
  }
  async seed(chatId, doc) {
    if (!this.docs.has(chatId)) this.docs.set(chatId, { ...doc });
  }
  // The edit is applied only if it was made on the current revision.
  async apply(chatId, base, fields) {
    const current = this.docs.get(chatId);
    if (!current) return { missing: true };
    if (current.revision !== base) return { ok: false, doc: { ...current } };
    const doc = { ...fields, revision: base + 1 };
    this.docs.set(chatId, doc);
    return { ok: true, doc: { ...doc } };
  }
  async drop(chatId, revision) {
    if (this.docs.get(chatId)?.revision === revision) this.docs.delete(chatId);
  }
  clear() {
    this.docs.clear();
  }
}

// ---- working copies in Redis ----
const SEED = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'code', ARGV[1], 'language', ARGV[2], 'fileName', ARGV[3], 'updatedBy', ARGV[4], 'revision', ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[6])
return 1
`;
const APPLY = `
local revision = redis.call('HGET', KEYS[1], 'revision')
if not revision then return { -1 } end
if tonumber(revision) ~= tonumber(ARGV[1]) then return { 0 } end
local next = tonumber(revision) + 1
redis.call('HSET', KEYS[1], 'code', ARGV[2], 'language', ARGV[3], 'fileName', ARGV[4], 'updatedBy', ARGV[5], 'revision', next)
redis.call('EXPIRE', KEYS[1], ARGV[6])
return { 1, next }
`;

class RedisCopies {
  constructor(client) {
    this.client = client;
  }
  key(chatId) {
    return `${config.redis.keyPrefix}livecode:${chatId}`;
  }
  async get(chatId) {
    const hash = await this.client.hGetAll(this.key(chatId));
    if (!hash.revision) return null;
    return toDocument({
      ...hash,
      updatedBy: hash.updatedBy || null,
    });
  }
  async seed(chatId, doc) {
    await this.client.eval(SEED, {
      keys: [this.key(chatId)],
      arguments: [
        doc.code,
        doc.language,
        doc.fileName,
        doc.updatedBy ?? "",
        String(doc.revision),
        String(WORKING_COPY_SECONDS),
      ],
    });
  }
  async apply(chatId, base, fields) {
    const [status, revision] = await this.client.eval(APPLY, {
      keys: [this.key(chatId)],
      arguments: [
        String(base),
        fields.code,
        fields.language,
        fields.fileName,
        fields.updatedBy ?? "",
        String(WORKING_COPY_SECONDS),
      ],
    });
    if (Number(status) === -1) return { missing: true };
    if (Number(status) === 0) return { ok: false, doc: await this.get(chatId) };
    return { ok: true, doc: { ...fields, revision: Number(revision) } };
  }
  async drop() {
    // Left to expire: other instances may still be using it.
  }
}

const memory = new MemoryCopies();

// The copies in use now: Redis while it is connected, memory otherwise.
const copies = () => {
  const client = config.redis.url ? getRedisClient() : null;
  return client ? new RedisCopies(client) : memory;
};

// ---- saving to MongoDB ----
// chatId -> { doc, timer, firstAt }: the newest edit this instance accepted
// that is not saved yet.
const pending = new Map();
const inflight = new Set();

// Writes a document unless the stored one is already as new or newer, so
// instances saving in a different order still end on the highest revision.
async function persist(chatId, doc) {
  const set = {
    code: doc.code,
    language: doc.language,
    fileName: doc.fileName,
    revision: doc.revision,
    ...(doc.updatedBy && { updatedBy: doc.updatedBy }),
  };
  const filter = {
    chatId,
    $or: [
      { revision: mongoose.trusted({ $lt: doc.revision }) },
      { revision: mongoose.trusted({ $exists: false }) },
    ],
  };

  try {
    await LiveCode.updateOne(filter, { $set: set }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
    // The document exists and is not behind this one (or was created a moment
    // ago by another instance): update it only if it is behind.
    await LiveCode.updateOne(filter, { $set: set });
  }
}

async function flushChat(chatId) {
  const entry = pending.get(chatId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(chatId);

  const run = (async () => {
    try {
      await persist(chatId, entry.doc);
      await memory.drop(chatId, entry.doc.revision);
    } catch (err) {
      logger.warn({ err: err.message, chatId }, "Could not save live code");
      // Keep the edit and try again, unless a newer one has arrived.
      if (!pending.has(chatId)) schedule(chatId, entry.doc);
    }
  })();
  inflight.add(run);
  run.finally(() => inflight.delete(run));
  await run;
}

function schedule(chatId, doc) {
  const entry = pending.get(chatId) ?? { firstAt: Date.now() };
  entry.doc = doc;
  clearTimeout(entry.timer);

  const delay = config.liveCode.flushMs;
  const left = entry.firstAt + delay * MAX_WAIT_FACTOR - Date.now();
  entry.timer = setTimeout(
    () => flushChat(chatId),
    Math.max(Math.min(delay, left), 0)
  );
  entry.timer.unref?.();
  pending.set(chatId, entry);
}

// Saves the given chats' unsaved edits now (all of them without an argument),
// and waits for saves already running.
export async function flushLiveCode(chatIds = [...pending.keys()]) {
  await Promise.all(chatIds.map((chatId) => flushChat(String(chatId))));
  await Promise.allSettled([...inflight]);
}

// Forgets unsaved edits and in-memory copies (for tests).
export function resetLiveCode() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  memory.clear();
}

// ---- reading and editing ----
async function load(chatId) {
  const stored = await LiveCode.findOne({ chatId });
  return stored ? toDocument(stored) : blank();
}

// The current document of a chat, or null if nobody has edited it yet. A
// working copy newer than the stored one is saved first, so what is returned
// is also what MongoDB holds.
export async function getLiveCodeDocument(chatId) {
  const id = String(chatId);
  const working = await copies().get(id);
  let stored = await LiveCode.findOne({ chatId: id });
  if (working?.revision > 0 && (stored?.revision ?? -1) < working.revision) {
    await persist(id, working);
    stored = await LiveCode.findOne({ chatId: id });
  }
  return stored;
}

// Applies an edit made on `baseRevision`. Returns { ok: true, document } for
// an accepted edit, or { ok: false, document } with the current document when
// the base is not the current revision.
export async function applyEdit(userId, edit) {
  const chatId = String(edit.chatId);
  const fields = {
    code: edit.code,
    language: edit.language ?? "plaintext",
    fileName: edit.fileName ?? "main",
    updatedBy: String(userId),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const store = copies();
    if (!(await store.get(chatId)))
      await store.seed(chatId, await load(chatId));

    const result = await store.apply(chatId, edit.baseRevision, fields);
    // The working copy expired between the two steps: seed it again.
    if (result.missing) continue;

    if (!result.ok) return { ok: false, document: result.doc };
    const document = toDocument(result.doc);
    schedule(chatId, document);
    return { ok: true, document };
  }
  throw new Error("live code working copy is unavailable");
}
