import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { chatRoom, liveCodeRoom } from "../utils/rooms.js";
import { removeUserFromRooms } from "../utils/socketOps.js";
import { notifyUser } from "./notificationService.js";

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

// Creates a group with the creator as its admin and notifies the members.
export async function createGroup(creator, { chatName, members }, io) {
  const creatorId = creator._id.toString();
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
    members: [creator._id, ...memberIds],
    admins: [creator._id],
  });

  const fullGroup = await Chat.findById(group._id).populate(
    "members",
    "username avatarKey"
  );

  await Promise.all(
    memberIds.map((userId) =>
      notifyUser(io, {
        userId,
        type: "group",
        content: `${creator.username} added you to ${chatName}`,
        fromUser: creator._id,
        chatId: group._id,
      })
    )
  );

  return fullGroup;
}

export async function addMember(actor, { chatId, userId }, io) {
  const chat = await loadGroupAsAdmin(chatId, actor, "add members");

  if (!(await User.exists({ _id: userId }))) throw notFound("User not found");

  if (chat.members.some((member) => sameId(member, userId))) {
    throw badRequest("User already in group");
  }

  chat.members.push(userId);
  await chat.save();

  await notifyUser(io, {
    userId,
    type: "group",
    content: `${actor.username} added you to ${chat.chatName}`,
    fromUser: actor._id,
    chatId: chat._id,
  });
}

export async function removeMember(actor, { chatId, userId }, io) {
  const chat = await loadGroupAsAdmin(chatId, actor, "remove members");

  const isAdmin = chat.admins.some((admin) => sameId(admin, userId));
  if (isAdmin && chat.admins.length === 1) {
    throw badRequest("A group needs at least one admin");
  }

  chat.members = chat.members.filter((id) => !sameId(id, userId));
  chat.admins = chat.admins.filter((id) => !sameId(id, userId));
  await chat.save();

  // Stop delivering this chat to the removed member's open connections.
  removeUserFromRooms(io, userId, [chatRoom(chat.id), liveCodeRoom(chat.id)]);
}

export async function renameGroup(actor, { chatId, newName }) {
  const chat = await loadGroupAsAdmin(chatId, actor, "rename");
  chat.chatName = newName;
  await chat.save();
}
