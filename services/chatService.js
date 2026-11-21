import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { badRequest, forbidden, notFound } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";
import { config } from "../config/index.js";
import { HttpError } from "../utils/httpError.js";
import { IMAGE_TYPES } from "../utils/fileType.js";
import { deleteMedia, uploadMedia } from "../utils/s3Utils.js";
import { messageView } from "../utils/serializers.js";
import { notifyMentions } from "./mentionService.js";
import { getLiveCodeDocument } from "./liveCodeService.js";
import { logger } from "../utils/logger.js";
import { chatRoom, userRoom } from "../utils/rooms.js";

// Loads a chat and makes sure the user belongs to it.
// 404 for a missing chat, 403 for non-members. The id must already be validated.
export async function loadChatForMember(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw notFound("Chat not found");

  const isMember = chat.members.some((member) => member.equals(userId));
  if (!isMember) throw forbidden("You are not a member of this chat");

  return chat;
}

// Finds or creates the direct chat between two users.
export async function accessChat(userId, otherUserId) {
  if (otherUserId === userId.toString()) {
    throw badRequest("You can't start a chat with yourself");
  }

  const otherUser = await User.exists({ _id: otherUserId });
  if (!otherUser) throw notFound("User not found");

  // Only a direct chat with exactly these two members counts.
  let chat = await Chat.findOne({
    isGroupChat: false,
    members: mongoose.trusted({ $all: [userId, otherUserId], $size: 2 }),
  });

  if (!chat) {
    chat = await Chat.create({
      isGroupChat: false,
      members: [userId, otherUserId],
    });
  }
  return chat;
}

// A user's chats, most recent activity first.
export function listChats(userId, { limit, cursor }) {
  return paginate(Chat, {
    filter: { members: userId },
    sortField: "updatedAt",
    limit,
    cursor,
    build: (query) =>
      query.populate("members", "username avatarKey").populate({
        path: "latestMessage",
        select: "sender type text media.mimeType createdAt",
        populate: { path: "sender", select: "username" },
      }),
  });
}

// Tells the chat's members about a new message, from the server. It goes to
// the chat room and to every member's own room (a socket in both gets it
// once). Blocked members are left out, and so is anyone who is no longer a
// member, because only the current member list is addressed.
async function deliverMessage(io, chat, message) {
  if (!io) return;
  try {
    const members = await User.find({
      _id: mongoose.trusted({ $in: chat.members }),
    }).select("isBlocked");
    const allowed = members.filter((member) => !member.isBlocked);
    const blocked = members.filter((member) => member.isBlocked);

    let target = io.to(chatRoom(chat.id));
    for (const member of allowed) target = target.to(userRoom(member.id));
    if (blocked.length) {
      target = target.except(blocked.map((member) => userRoom(member.id)));
    }
    target.emit("receive-message", await messageView(message));
  } catch (err) {
    // The message is saved; a failed push must not fail the request.
    logger.warn({ err: err.message }, "Could not deliver message");
  }
}

// The one way a message is sent, for REST and sockets: saves it, moves the
// chat's latest message, and delivers it to the members.
export async function sendMessage(
  userId,
  { chatId, type, text, code, media },
  io
) {
  const chat = await loadChatForMember(chatId, userId);

  const messageData = { chat: chat._id, sender: userId, type };

  if (type === "code") {
    messageData.code = {
      language: code.language || "plaintext",
      content: code.content,
    };
  } else if (type === "media") {
    messageData.media = media;
  } else {
    messageData.text = text;
  }

  const created = await Message.create(messageData);
  // Also moves the chat to the top of the list (its updatedAt changes).
  await Chat.findByIdAndUpdate(chat._id, { latestMessage: created._id });

  const message = await Message.findById(created._id)
    .populate("sender", "username")
    .populate("chat", "isGroupChat chatName");

  await deliverMessage(io, chat, message);
  await notifyMentions(io, { chat, message, sender: message.sender });
  return message;
}

// A file name as shown to other people: no path, no control characters, and a
// sensible length. It is only a label; the stored key never uses it.
export function cleanFileName(name) {
  // Multer reads the header as latin1; browsers send UTF-8.
  const decoded = Buffer.from(String(name ?? ""), "latin1").toString("utf8");
  const base = decoded.split(/[\\/]/).pop();
  // eslint-disable-next-line no-control-regex
  const safe = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  if (!safe || /^\.+$/.test(safe)) return "file";
  if (safe.length <= 120) return safe;
  const dot = safe.lastIndexOf(".");
  const extension = dot > 0 ? safe.slice(dot).slice(0, 10) : "";
  return safe.slice(0, 120 - extension.length) + extension;
}

// Sends an image or a PDF or ZIP file to a chat. The member check comes before
// anything is stored, the stored key is generated here, and the message goes
// out through sendMessage like any other.
export async function sendMediaMessage(userId, { chatId, file }, io) {
  const chat = await loadChatForMember(chatId, userId);
  if (!file) throw new HttpError(400, "A file is required");

  const isImage = IMAGE_TYPES.includes(file.mimetype);
  const limit = isImage
    ? config.chatMedia.imageMaxBytes
    : config.chatMedia.fileMaxBytes;
  if (file.size > limit) {
    throw new HttpError(
      413,
      `${isImage ? "Images" : "Files"} can be at most ${limit / (1024 * 1024)} MB`
    );
  }

  const key = await uploadMedia({
    buffer: file.buffer,
    mimetype: file.mimetype,
    prefix: "chat",
  });

  try {
    return await sendMessage(
      userId,
      {
        chatId: chat.id,
        type: "media",
        media: {
          mimeType: file.mimetype,
          key,
          size: file.size,
          fileName: cleanFileName(file.originalname),
        },
      },
      io
    );
  } catch (err) {
    // Nothing refers to the stored file.
    await deleteMedia(key);
    throw err;
  }
}

// Newest first; ask for the cursor of a page to get the older messages.
export async function listMessages(userId, chatId, { limit, cursor }) {
  const chat = await loadChatForMember(chatId, userId);

  return paginate(Message, {
    filter: { chat: chat._id },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("sender", "username"),
  });
}

// The shared code document of a chat, or null.
export async function getLiveCode(userId, chatId) {
  const chat = await loadChatForMember(chatId, userId);
  return getLiveCodeDocument(chat._id);
}
