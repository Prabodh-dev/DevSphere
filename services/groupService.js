import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import ChatRead from "../models/ChatRead.js";
import LiveCode from "../models/LiveCode.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { chatRoom, liveCodeRoom, userRoom } from "../utils/rooms.js";
import { emptyChatRooms, removeUserFromRooms } from "../utils/socketOps.js";
import { deleteMedia } from "../utils/s3Utils.js";
import { discardLiveCode } from "./liveCodeService.js";
import { notifyUser, removeNotificationsFor } from "./notificationService.js";

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

async function loadGroup(chatId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw notFound("Chat not found");
  if (!chat.isGroupChat) throw badRequest("Not a group chat");
  return chat;
}

const isIn = (list, userId) => list.some((id) => sameId(id, userId));

// Tells the members of a group (and the given users, who may already have been
// taken out of its room) that something about it changed. Call it before the
// rooms are emptied, so those who are leaving hear it too.
function announce(io, chat, payload, alsoTo = []) {
  if (!io) return;
  io.to([chatRoom(chat.id), ...alsoTo.map(userRoom)]).emit("group-updated", {
    chatId: chat.id,
    ...payload,
  });
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
  announce(io, chat, { change: "member-added", userId }, [userId]);

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
  announce(io, chat, { change: "member-removed", userId }, [userId]);
  removeUserFromRooms(io, userId, [chatRoom(chat.id), liveCodeRoom(chat.id)]);
}

export async function renameGroup(actor, { chatId, newName }, io) {
  const chat = await loadGroupAsAdmin(chatId, actor, "rename");
  chat.chatName = newName;
  await chat.save();
  announce(io, chat, { change: "renamed", chatName: newName });
}

// A member leaves. The last admin cannot: they promote someone first, or
// delete the group.
export async function leaveGroup(actor, { chatId }, io) {
  const chat = await loadGroup(chatId);
  if (!isIn(chat.members, actor._id)) {
    throw forbidden("You are not a member of this group");
  }
  if (isIn(chat.admins, actor._id) && chat.admins.length === 1) {
    throw badRequest(
      "You are the only admin: make another member an admin, or delete the group"
    );
  }

  chat.members = chat.members.filter((id) => !sameId(id, actor._id));
  chat.admins = chat.admins.filter((id) => !sameId(id, actor._id));
  await chat.save();

  announce(io, chat, { change: "member-left", userId: actor._id.toString() }, [
    actor._id,
  ]);
  removeUserFromRooms(io, actor._id, [
    chatRoom(chat.id),
    liveCodeRoom(chat.id),
  ]);
}

export async function promoteMember(actor, { chatId, userId }, io) {
  const chat = await loadGroupAsAdmin(chatId, actor, "make admins");
  if (!isIn(chat.members, userId)) {
    throw badRequest("That user is not in this group");
  }
  if (isIn(chat.admins, userId)) throw badRequest("User is already an admin");

  chat.admins.push(userId);
  await chat.save();
  announce(io, chat, { change: "admin-promoted", userId });
}

export async function demoteMember(actor, { chatId, userId }, io) {
  const chat = await loadGroupAsAdmin(chatId, actor, "remove admins");
  if (!isIn(chat.admins, userId)) throw badRequest("User is not an admin");
  if (chat.admins.length === 1) {
    throw badRequest("A group needs at least one admin");
  }

  chat.admins = chat.admins.filter((id) => !sameId(id, userId));
  await chat.save();
  announce(io, chat, { change: "admin-demoted", userId });
}

// Deletes a group with everything that belongs to it: its messages (and the
// files they refer to), read markers, live code document and notifications.
export async function deleteGroup(actor, { chatId }, io) {
  const chat = await loadGroupAsAdmin(chatId, actor, "delete the group");

  const withFiles = await Message.find({
    chat: chat._id,
    "media.key": mongoose.trusted({ $exists: true }),
  }).select("media.key");
  await Promise.all(withFiles.map((message) => deleteMedia(message.media.key)));

  await discardLiveCode(chat._id);
  await Promise.all([
    Message.deleteMany({ chat: chat._id }),
    ChatRead.deleteMany({ chat: chat._id }),
    LiveCode.deleteMany({ chatId: chat._id }),
    removeNotificationsFor({ chatId: chat._id }),
  ]);
  await Chat.deleteOne({ _id: chat._id });

  announce(io, chat, { change: "deleted" }, chat.members);
  emptyChatRooms(io, chat.id);
}
