import Chat from "../models/Chat.js";
import Message from "../models/Message.js";

const PREVIEW_LENGTH = 100;

// Short text shown in the chat list for a message.
export function previewOf(message) {
  if (message.type === "code") return "[code]";
  const text = (message.text ?? "").trim();
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH)}…`
    : text;
}

// Points a chat at its newest remaining message after one was removed. This is
// housekeeping, so the chat's updatedAt is not touched.
export async function refreshLatestMessage(chatId, removedMessageId) {
  const pointsAtRemoved = await Chat.exists({
    _id: chatId,
    latestMessage: removedMessageId,
  });
  if (!pointsAtRemoved) return;

  const newest = await Message.findOne({ chat: chatId }).sort({
    createdAt: -1,
    _id: -1,
  });
  await Chat.updateOne(
    { _id: chatId },
    newest
      ? { $set: { latestMessage: newest._id } }
      : { $unset: { latestMessage: "" } },
    { timestamps: false }
  );
}
