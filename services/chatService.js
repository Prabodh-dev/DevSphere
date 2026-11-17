import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import LiveCode from "../models/LiveCode.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";

// Loads a chat and makes sure the user belongs to it.
// 404 for a missing chat, 403 for non-members. The id must already be validated.
export async function loadChatForMember(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw notFound("Chat not found");

  const isMember = chat.members.some((member) => member.equals(userId));
  if (!isMember) throw forbidden("You are not a member of this chat");

  return chat;
}

// Finds or creates the direct chat between two users.
export async function accessChat(userId, otherUserId) {
  if (otherUserId === userId.toString()) {
    throw badRequest("You can't start a chat with yourself");
  }

  const otherUser = await User.exists({ _id: otherUserId });
  if (!otherUser) throw notFound("User not found");

  // Only a direct chat with exactly these two members counts.
  let chat = await Chat.findOne({
    isGroupChat: false,
    members: mongoose.trusted({ $all: [userId, otherUserId], $size: 2 }),
  });

  if (!chat) {
    chat = await Chat.create({
      isGroupChat: false,
      members: [userId, otherUserId],
    });
  }
  return chat;
}

// A user's chats, most recent activity first.
export function listChats(userId, { limit, cursor }) {
  return paginate(Chat, {
    filter: { members: userId },
    sortField: "updatedAt",
    limit,
    cursor,
    build: (query) =>
      query.populate("members", "username avatarKey").populate({
        path: "latestMessage",
        select: "sender type text createdAt",
        populate: { path: "sender", select: "username" },
      }),
  });
}

export async function sendMessage(userId, { chatId, type, text, code }) {
  const chat = await loadChatForMember(chatId, userId);

  const messageData = { chat: chat._id, sender: userId, type };

  if (type === "code") {
    messageData.code = {
      language: code.language || "plaintext",
      content: code.content,
    };
  } else {
    messageData.text = text;
  }

  const message = await Message.create(messageData);
  // Also moves the chat to the top of the list (its updatedAt changes).
  await Chat.findByIdAndUpdate(chat._id, { latestMessage: message._id });

  return Message.findById(message._id)
    .populate("sender", "username")
    .populate("chat", "isGroupChat chatName");
}

// Newest first; ask for the cursor of a page to get the older messages.
export async function listMessages(userId, chatId, { limit, cursor }) {
  const chat = await loadChatForMember(chatId, userId);

  return paginate(Message, {
    filter: { chat: chat._id },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("sender", "username"),
  });
}

// The shared code document of a chat, or null.
export async function getLiveCode(userId, chatId) {
  const chat = await loadChatForMember(chatId, userId);
  return LiveCode.findOne({ chatId: chat._id });
}
