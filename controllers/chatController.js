// Group chat management.
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import {
  isObjectId,
  requireObjectId,
  requireString,
} from "../utils/validate.js";

const sameId = (a, b) => String(a) === String(b);

async function loadGroupAsAdmin(chatId, user, action) {
  requireObjectId(chatId, "chatId");

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
  const body = req.body ?? {};
  const chatName = requireString(body.chatName, "chatName", { max: 100 });

  if (!Array.isArray(body.members) || !body.members.every(isObjectId)) {
    throw badRequest("members must be a list of user ids");
  }

  const creatorId = req.user._id.toString();
  const memberIds = [...new Set(body.members)].filter((id) => id !== creatorId);

  if (memberIds.length < 2) {
    throw badRequest("Group must have name and at least 2 members");
  }

  const existing = await User.countDocuments({ _id: { $in: memberIds } });
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
    "-password"
  );

  res.status(201).json(fullGroup);
};

// Add member (admin only)
export const addToGroup = async (req, res) => {
  const chat = await loadGroupAsAdmin(
    req.body?.chatId,
    req.user,
    "add members"
  );
  const userId = requireObjectId(req.body?.userId, "userId");

  if (!(await User.exists({ _id: userId }))) throw notFound("User not found");

  if (chat.members.some((member) => sameId(member, userId))) {
    throw badRequest("User already in group");
  }

  chat.members.push(userId);
  await chat.save();

  res.status(200).json({ message: "User added" });
};

// Remove member (admin only)
export const removeFromGroup = async (req, res) => {
  const chat = await loadGroupAsAdmin(
    req.body?.chatId,
    req.user,
    "remove members"
  );
  const userId = requireObjectId(req.body?.userId, "userId");

  const isAdmin = chat.admins.some((admin) => sameId(admin, userId));
  if (isAdmin && chat.admins.length === 1) {
    throw badRequest("A group needs at least one admin");
  }

  chat.members = chat.members.filter((id) => !sameId(id, userId));
  chat.admins = chat.admins.filter((id) => !sameId(id, userId));
  await chat.save();

  res.status(200).json({ message: "User removed" });
};

// Rename group (admin only)
export const renameGroup = async (req, res) => {
  const chat = await loadGroupAsAdmin(req.body?.chatId, req.user, "rename");
  chat.chatName = requireString(req.body?.newName, "newName", { max: 100 });
  await chat.save();

  res.status(200).json({ message: "Group renamed" });
};
