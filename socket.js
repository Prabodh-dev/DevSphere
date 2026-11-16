// socket.js
import { Server } from "socket.io";
import { getRedisClient, initRedis } from "./config/redis.js";
import LiveCode from "./models/LiveCode.js";
import { isObjectId } from "./utils/validate.js";

const MAX_CODE_LENGTH = 200000;

// Raised for bad client input; the message is safe to send back.
class SocketInputError extends Error {}

const requireChatId = (value) => {
  if (!isObjectId(value)) throw new SocketInputError("Invalid chatId");
  return value;
};

const requireObject = (value) => {
  if (!value || typeof value !== "object") {
    throw new SocketInputError("Invalid payload");
  }
  return value;
};

const optionalText = (value, name, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || value.length > 200) {
    throw new SocketInputError(`Invalid ${name}`);
  }
  return value;
};

// Presence is best effort: a Redis problem must never break a socket.
const setPresence = async (command, userId) => {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client[command]("onlineUsers", userId);
  } catch (err) {
    console.warn(`Redis ${command} failed:`, err.message);
  }
};

export const setupSocketIO = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Connects in the background; never blocks connections.
  initRedis();

  io.on("connection", (socket) => {
    const userId = socket.handshake.query.userId;
    if (!isObjectId(userId)) return socket.disconnect();

    // Personal room, so events can be addressed to a user.
    socket.join(userId);

    // Wraps a handler so bad input or a failing query is reported to the
    // client and logged, instead of becoming an unhandled rejection.
    const on = (event, handler) => {
      socket.on(event, async (...args) => {
        try {
          await handler(...args);
        } catch (err) {
          if (err instanceof SocketInputError) {
            socket.emit("socket-error", { event, message: err.message });
          } else {
            console.error(`Socket event "${event}" failed:`, err);
            socket.emit("socket-error", { event, message: "Request failed" });
          }
        }
      });
    };

    // ========== Chat Events ==========
    on("join-chat", (chatId) => {
      socket.join(requireChatId(chatId));
    });

    on("send-message", (data) => {
      const { chatId, message } = requireObject(data);
      requireChatId(chatId);
      socket.to(chatId).emit("receive-message", message);
    });

    on("group-message", (data) => {
      const { chatId, message } = requireObject(data);
      requireChatId(chatId);
      io.to(chatId).emit("receive-message", message);
    });

    on("typing", (chatId) => {
      socket.to(requireChatId(chatId)).emit("typing", userId);
    });

    on("stop-typing", (chatId) => {
      socket.to(requireChatId(chatId)).emit("stop-typing", userId);
    });

    // ========== Live Code Editor ==========
    on("join-live-code", async (data) => {
      const { chatId } = requireObject(data);
      requireChatId(chatId);
      socket.join(`live-${chatId}`);
      const doc = await LiveCode.findOne({ chatId });
      if (doc) {
        socket.emit("load-code", doc);
      }
    });

    on("code-change", async (data) => {
      const { chatId, code, language, fileName } = requireObject(data);
      requireChatId(chatId);
      if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) {
        throw new SocketInputError("Invalid code");
      }
      const lang = optionalText(language, "language", "plaintext");
      const name = optionalText(fileName, "fileName", "main");

      await LiveCode.findOneAndUpdate(
        { chatId },
        { code, language: lang, fileName: name, updatedBy: userId },
        { upsert: true }
      );
      socket
        .to(`live-${chatId}`)
        .emit("code-update", { code, language: lang, fileName: name });
    });

    // ========== Notifications ==========
    on("send-notification", (data) => {
      const { toUserId, notification } = requireObject(data);
      if (!isObjectId(toUserId)) throw new SocketInputError("Invalid toUserId");
      io.to(toUserId).emit("receive-notification", notification);
    });

    // ========== Disconnect ==========
    on("disconnect", async () => {
      await setPresence("sRem", userId);
      socket.broadcast.emit("user-offline", userId);
    });

    // ========== Presence ==========
    setPresence("sAdd", userId);
    socket.broadcast.emit("user-online", userId);
  });

  return io;
};
