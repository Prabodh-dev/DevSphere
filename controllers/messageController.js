import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { loadChatForMember } from "../utils/chatAccess.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { chatView } from "../utils/serializers.js";

export const accessChat = async (req, res) => {
  const { userId } = req.valid.body;

  if (userId === req.user._id.toString()) {
    throw badRequest("You can't start a chat with yourself");
  }

  const otherUser = await User.exists({ _id: userId });
  if (!otherUser) throw notFound("User not found");

  // Only a direct chat with exactly these two members counts.
  let chat = await Chat.findOne({
    isGroupChat: false,
    members: mongoose.trusted({ $all: [req.user._id, userId], $size: 2 }),
  });

  if (!chat) {
    chat = await Chat.create({
      isGroupChat: false,
      members: [req.user._id, userId],
    });
  }

  res.status(200).json(chat);
};

export const fetchChats = async (req, res) => {
  const chats = await Chat.find({ members: req.user._id })
    .populate("members", "username avatarKey")
    .populate({
      path: "latestMessage",
      select: "sender type text createdAt",
      populate: { path: "sender", select: "username" },
    })
    .sort({ updatedAt: -1 });
  res.status(200).json(await Promise.all(chats.map(chatView)));
};

export const sendMessage = async (req, res) => {
  const { chatId, type, text, code } = req.valid.body;
  const chat = await loadChatForMember(chatId, req.user._id);

  const messageData = { chat: chat._id, sender: req.user._id, type };

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

  const fullMsg = await Message.findById(message._id)
    .populate("sender", "username")
    .populate("chat", "isGroupChat chatName");

  res.status(201).json(fullMsg);
};

export const getMessages = async (req, res) => {
  const chat = await loadChatForMember(req.valid.params.chatId, req.user._id);

  const messages = await Message.find({ chat: chat._id })
    .populate("sender", "username")
    .sort({ createdAt: 1 });

  res.status(200).json(messages);
};
