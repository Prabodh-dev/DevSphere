import * as chats from "../services/chatService.js";
import * as reads from "../services/readService.js";
import { chatView } from "../utils/serializers.js";

export const accessChat = async (req, res) => {
  const chat = await chats.accessChat(req.user._id, req.valid.body.userId);
  res.status(200).json(chat);
};

export const fetchChats = async (req, res) => {
  const { docs, nextCursor } = await chats.listChats(
    req.user._id,
    req.valid.query
  );
  const unread = await reads.unreadCounts(
    req.user._id,
    docs.map((chat) => chat._id)
  );
  const items = await Promise.all(
    docs.map((chat) => chatView(chat, unread.get(chat.id)))
  );
  res.status(200).json({ items, nextCursor });
};

export const sendMessage = async (req, res) => {
  const message = await chats.sendMessage(
    req.user._id,
    req.valid.body,
    req.app.get("io")
  );
  res.status(201).json(message);
};

export const getMessages = async (req, res) => {
  const { docs, nextCursor } = await chats.listMessages(
    req.user._id,
    req.valid.params.chatId,
    req.valid.query
  );
  res.status(200).json({ items: docs, nextCursor });
};

export const getLiveCode = async (req, res) => {
  const doc = await chats.getLiveCode(req.user._id, req.valid.params.chatId);
  res.status(200).json(doc);
};

export const markRead = async (req, res) => {
  const result = await reads.markRead(
    req.user._id,
    { chatId: req.valid.params.chatId, messageId: req.valid.body.messageId },
    req.app.get("io")
  );
  res.status(200).json(result);
};
