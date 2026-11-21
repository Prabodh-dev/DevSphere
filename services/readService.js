import mongoose from "mongoose";
import ChatRead from "../models/ChatRead.js";
import Message from "../models/Message.js";
import { notFound } from "../utils/httpError.js";
import { chatRoom } from "../utils/rooms.js";
import { loadChatForMember } from "./chatService.js";

// Messages from other people that come after the marker (or all of them
// without one). Messages are ordered by time, then id.
const unreadFilter = (chatId, userId, marker) => {
  const filter = { chat: chatId, sender: mongoose.trusted({ $ne: userId }) };
  if (marker) {
    filter.$or = [
      { createdAt: mongoose.trusted({ $gt: marker.lastReadAt }) },
      {
        createdAt: marker.lastReadAt,
        _id: mongoose.trusted({ $gt: marker.lastReadMessage }),
      },
    ];
  }
  return filter;
};

export async function unreadCount(userId, chatId) {
  const marker = await ChatRead.findOne({ chat: chatId, user: userId });
  return Message.countDocuments(unreadFilter(chatId, userId, marker));
}

// Unread counts for several chats at once, as a Map of chat id to count.
export async function unreadCounts(userId, chatIds) {
  const markers = await ChatRead.find({
    user: userId,
    chat: mongoose.trusted({ $in: chatIds }),
  });
  const byChat = new Map(markers.map((m) => [m.chat.toString(), m]));
  const counts = await Promise.all(
    chatIds.map((chatId) =>
      Message.countDocuments(
        unreadFilter(chatId, userId, byChat.get(chatId.toString()))
      )
    )
  );
  return new Map(chatIds.map((chatId, i) => [chatId.toString(), counts[i]]));
}

// Moves the member's "read up to" marker to a message of the chat. It only
// moves forward: an older message (or the same one) changes nothing. A change
// is announced to the chat room as a read receipt.
export async function markRead(userId, { chatId, messageId }, io) {
  const chat = await loadChatForMember(chatId, userId);
  const message = await Message.findOne({ _id: messageId, chat: chat._id });
  if (!message) throw notFound("Message not found");

  const ahead = [
    { lastReadAt: mongoose.trusted({ $lt: message.createdAt }) },
    {
      lastReadAt: message.createdAt,
      lastReadMessage: mongoose.trusted({ $lt: message._id }),
    },
  ];

  let changed = false;
  try {
    const result = await ChatRead.updateOne(
      { chat: chat._id, user: userId, $or: ahead },
      { $set: { lastReadMessage: message._id, lastReadAt: message.createdAt } },
      { upsert: true }
    );
    changed = result.modifiedCount + result.upsertedCount > 0;
  } catch (err) {
    // A marker exists that is not behind this message: nothing to move.
    if (err.code !== 11000) throw err;
  }

  const marker = await ChatRead.findOne({ chat: chat._id, user: userId });
  const readAt = new Date();
  if (changed) {
    io?.to(chatRoom(chat.id)).emit("read-receipt", {
      chatId: chat.id,
      userId: userId.toString(),
      messageId: marker.lastReadMessage.toString(),
      readAt,
    });
  }

  return {
    chatId: chat.id,
    messageId: marker.lastReadMessage.toString(),
    unreadCount: await Message.countDocuments(
      unreadFilter(chat._id, userId, marker)
    ),
    changed,
  };
}
