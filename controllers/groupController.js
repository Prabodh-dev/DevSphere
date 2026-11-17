// Group chat management.
import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { chatView } from "../utils/serializers.js";
import { notifyUser } from "../utils/notify.js";
import { chatRoom, liveCodeRoom, userRoom } from "../utils/rooms.js";

const sameId = (a, b) => String(a) === String(b);

async function loadGroupAsAdmin(chatId, user, action) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw notFound("Chat not found");
  if (!chat.isGroupChat) throw badRequest("Not a group chat");

  if (!chat.admins.some((admin) => sameId(admin, user._id))) {
    throw forbidden(`Only admins can ${action}`);
  }
  return chat;
}

// Create group chat
export const createGroupChat = async (req, res) => {
  const { chatName, members } = req.valid.body;

  const creatorId = req.user._id.toString();
  const memberIds = [...new Set(members)].filter((id) => id !== creatorId);

  if (memberIds.length < 2) {
    throw badRequest("Group must have name and at least 2 members");
  }

  const existing = await User.countDocuments({
    _id: mongoose.trusted({ $in: memberIds }),
  });
  if (existing !== memberIds.length) {
    throw badRequest("One or more members do not exist");
  }

  const group = await Chat.create({
    isGroupChat: true,
    chatName,
    members: [req.user._id, ...memberIds],
    admins: [req.user._id],
  });

  const fullGroup = await Chat.findById(group._id).populate(
    "members",
    "username avatarKey"
  );

  const io = req.app.get("io");
  await Promise.all(
    memberIds.map((userId) =>
      notifyUser(io, {
        userId,
        type: "group",
        content: `${req.user.username} added you to ${chatName}`,
        fromUser: req.user._id,
        chatId: group._id,
      })
    )
  );

  res.status(201).json(await chatView(fullGroup));
};

// Add member (admin only)
export const addToGroup = async (req, res) => {
  const { chatId, userId } = req.valid.body;
  const chat = await loadGroupAsAdmin(chatId, req.user, "add members");

  if (!(await User.exists({ _id: userId }))) throw notFound("User not found");

  if (chat.members.some((member) => sameId(member, userId))) {
    throw badRequest("User already in group");
  }

  chat.members.push(userId);
  await chat.save();

  await notifyUser(req.app.get("io"), {
    userId,
    type: "group",
    content: `${req.user.username} added you to ${chat.chatName}`,
    fromUser: req.user._id,
    chatId: chat._id,
  });

  res.status(200).json({ message: "User added" });
};

// Remove member (admin only)
export const removeFromGroup = async (req, res) => {
  const { chatId, userId } = req.valid.body;
  const chat = await loadGroupAsAdmin(chatId, req.user, "remove members");

  const isAdmin = chat.admins.some((admin) => sameId(admin, userId));
  if (isAdmin && chat.admins.length === 1) {
    throw badRequest("A group needs at least one admin");
  }

  chat.members = chat.members.filter((id) => !sameId(id, userId));
  chat.admins = chat.admins.filter((id) => !sameId(id, userId));
  await chat.save();

  // Stop delivering this chat to the removed member's open connections.
  req.app
    .get("io")
    ?.in(userRoom(userId))
    .socketsLeave([chatRoom(chat.id), liveCodeRoom(chat.id)]);

  res.status(200).json({ message: "User removed" });
};

// Rename group (admin only)
export const renameGroup = async (req, res) => {
  const { chatId, newName } = req.valid.body;
  const chat = await loadGroupAsAdmin(chatId, req.user, "rename");
  chat.chatName = newName;
  await chat.save();

  res.status(200).json({ message: "Group renamed" });
};
