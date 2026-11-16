import Chat from "../models/Chat.js";
import { forbidden, notFound } from "./httpError.js";
import { requireObjectId } from "./validate.js";

// Loads a chat and makes sure the user belongs to it.
// 400 for a malformed id, 404 for a missing chat, 403 for non-members.
export async function loadChatForMember(chatId, userId) {
  requireObjectId(chatId, "chatId");

  const chat = await Chat.findById(chatId);
  if (!chat) throw notFound("Chat not found");

  const isMember = chat.members.some((member) => member.equals(userId));
  if (!isMember) throw forbidden("You are not a member of this chat");

  return chat;
}
