import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { loadChatForMember } from "../utils/chatAccess.js";
import { badRequest, notFound } from "../utils/httpError.js";
import {
  requireObjectId,
  requireOneOf,
  requireString,
} from "../utils/validate.js";

const MESSAGE_TYPES = ["text", "media", "code"];

export const accessChat = async (req, res) => {
  const userId = requireObjectId(req.body?.userId, "userId");

  if (userId === req.user._id.toString()) {
    throw badRequest("You can't start a chat with yourself");
  }

  const otherUser = await User.exists({ _id: userId });
  if (!otherUser) throw notFound("User not found");

  // Only a direct chat with exactly these two members counts.
  let chat = await Chat.findOne({
    isGroupChat: false,
    members: { $all: [req.user._id, userId], $size: 2 },
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
    .populate("members", "-password")
    .sort({ updatedAt: -1 });
  res.status(200).json(chats);
};

export const sendMessage = async (req, res) => {
  const body = req.body ?? {};
  const type = requireOneOf(body.type ?? "text", MESSAGE_TYPES, "type");
  const chat = await loadChatForMember(body.chatId, req.user._id);

  const messageData = {
    chat: chat._id,
    sender: req.user._id,
    type,
  };

  if (type === "code") {
    const code = body.code ?? {};
    messageData.code = {
      language:
        typeof code.language === "string" && code.language
          ? code.language
          : "plaintext",
      content: requireString(code.content, "code.content", { max: 100000 }),
    };
  } else {
    messageData.text = requireString(body.text, "text", { max: 5000 });
  }

  const message = await Message.create(messageData);
  await Chat.findByIdAndUpdate(chat._id, { updatedAt: new Date() });

  const fullMsg = await Message.findById(message._id)
    .populate("sender", "username")
    .populate("chat");

  res.status(201).json(fullMsg);
};

export const getMessages = async (req, res) => {
  const chat = await loadChatForMember(req.params.chatId, req.user._id);

  const messages = await Message.find({ chat: chat._id })
    .populate("sender", "username")
    .sort({ createdAt: 1 });

  res.status(200).json(messages);
};
