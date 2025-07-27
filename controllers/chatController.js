// controllers/groupController.js

import Chat from "../models/Chat.js";
import User from "../models/User.js";

// Create group chat
export const createGroupChat = async (req, res) => {
  const { chatName, members } = req.body;

  if (!chatName || !members || members.length < 2) {
    return res
      .status(400)
      .json({ message: "Group must have name and at least 2 members" });
  }

  members.push(req.user._id); // Include creator

  try {
    const group = await Chat.create({
      isGroupChat: true,
      chatName,
      members,
      admins: [req.user._id],
    });

    const fullGroup = await Chat.findById(group._id).populate(
      "members",
      "-password"
    );

    res.status(201).json(fullGroup);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Group creation failed", error: err.message });
  }
};

// Add member (admin only)
export const addToGroup = async (req, res) => {
  const { chatId, userId } = req.body;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat.isGroupChat)
      return res.status(400).json({ message: "Not a group chat" });

    if (!chat.admins.includes(req.user._id)) {
      return res.status(403).json({ message: "Only admins can add members" });
    }

    if (chat.members.includes(userId)) {
      return res.status(400).json({ message: "User already in group" });
    }

    chat.members.push(userId);
    await chat.save();

    res.status(200).json({ message: "User added" });
  } catch (err) {
    res.status(500).json({ message: "Add failed", error: err.message });
  }
};

// Remove member (admin only)
export const removeFromGroup = async (req, res) => {
  const { chatId, userId } = req.body;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat.isGroupChat)
      return res.status(400).json({ message: "Not a group chat" });

    if (!chat.admins.includes(req.user._id)) {
      return res
        .status(403)
        .json({ message: "Only admins can remove members" });
    }

    chat.members = chat.members.filter((id) => id.toString() !== userId);
    chat.admins = chat.admins.filter((id) => id.toString() !== userId);
    await chat.save();

    res.status(200).json({ message: "User removed" });
  } catch (err) {
    res.status(500).json({ message: "Remove failed", error: err.message });
  }
};

// Rename group (admin only)
export const renameGroup = async (req, res) => {
  const { chatId, newName } = req.body;

  try {
    const chat = await Chat.findById(chatId);
    if (!chat.admins.includes(req.user._id)) {
      return res.status(403).json({ message: "Only admins can rename" });
    }

    chat.chatName = newName;
    await chat.save();

    res.status(200).json({ message: "Group renamed" });
  } catch (err) {
    res.status(500).json({ message: "Rename failed", error: err.message });
  }
};
