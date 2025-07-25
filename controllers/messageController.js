import Chat from "../models/Chat.js";
import Message from "../models/Message.js";

export const accessChat = async (req, res) => {
  const { userId } = req.body;

  try {
    let chat = await Chat.findOne({
      members: { $all: [req.user._id, userId] },
    });

    if (!chat) {
      chat = await Chat.create({ members: [req.user._id, userId] });
    }

    res.status(200).json(chat);
  } catch (err) {
    res.status(500).json({ error: "Failed to access/create chat" });
  }
};

export const fetchChats = async (req, res) => {
  try {
    const chats = await Chat.find({ members: req.user._id })
      .populate("members", "-password")
      .sort({ updatedAt: -1 });
    res.status(200).json(chats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch chats" });
  }
};

export const sendMessage = async (req, res) => {
  const { chatId, text } = req.body;

  try {
    const message = await Message.create({
      chat: chatId,
      sender: req.user._id,
      text,
    });

    await Chat.findByIdAndUpdate(chatId, { updatedAt: new Date() });

    const fullMsg = await Message.findById(message._id)
      .populate("sender", "username")
      .populate("chat");

    res.status(201).json(fullMsg);
  } catch (err) {
    res.status(500).json({ error: "Failed to send message" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const messages = await Message.find({ chat: req.params.chatId })
      .populate("sender", "username")
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};
