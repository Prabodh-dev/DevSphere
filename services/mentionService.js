import mongoose from "mongoose";
import User from "../models/User.js";
import { logger } from "../utils/logger.js";
import { notifyUser } from "./notificationService.js";

// At most this many people are notified by one message.
const MAX_MENTIONS = 20;
// @name at the start of the text or after a space or punctuation (not inside
// an address such as ada@example.com).
const MENTION = /(?<![\w@])@([A-Za-z0-9_.-]{3,30})/g;

// The usernames mentioned in a text, without repeats.
export function extractMentions(text) {
  const names = new Set();
  for (const match of String(text ?? "").matchAll(MENTION)) {
    // A dot or dash at the end is punctuation: "thanks @ada."
    const name = match[1].replace(/[.-]+$/, "");
    if (name.length >= 3) names.add(name);
    if (names.size >= MAX_MENTIONS) break;
  }
  return [...names];
}

// Notifies the members of a chat who are mentioned in a text message. Only
// members count: mentioning someone outside the chat tells them nothing.
export async function notifyMentions(io, { chat, message, sender }) {
  if (message.type !== "text") return;
  const names = extractMentions(message.text);
  if (!names.length) return;

  try {
    const people = await User.find({
      username: mongoose.trusted({ $in: names }),
      _id: mongoose.trusted({ $in: chat.members }),
      isBlocked: false,
    }).select("_id");

    const where = chat.isGroupChat ? chat.chatName || "a group" : "a chat";
    await Promise.all(
      people.map((person) =>
        notifyUser(io, {
          userId: person._id,
          type: "mention",
          content: `${sender.username} mentioned you in ${where}`,
          fromUser: sender._id,
          chatId: chat._id,
          messageId: message._id,
          dedupeKey: `mention:${message._id}`,
        })
      )
    );
  } catch (err) {
    logger.warn({ err: err.message }, "Could not notify mentions");
  }
}
