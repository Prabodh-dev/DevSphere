import * as chats from "../services/chatService.js";
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
  res
    .status(200)
    .json({ items: await Promise.all(docs.map(chatView)), nextCursor });
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
