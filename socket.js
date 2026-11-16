// socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { getRedisClient, initRedis } from "./config/redis.js";
import { getCorsOrigins } from "./config/env.js";
import Chat from "./models/Chat.js";
import LiveCode from "./models/LiveCode.js";
import User from "./models/User.js";
import { chatRoom, liveCodeRoom, userRoom } from "./utils/rooms.js";
import {
  chatIdPayload,
  codeChangePayload,
  joinLiveCodePayload,
  messagePayload,
} from "./schemas/socket.js";

// Largest single packet the transport accepts.
const MAX_PACKET_BYTES = 512 * 1024;

const DEFAULT_RATE_LIMIT = { max: 100, windowMs: 10 * 1000 };
// Events dropped in a row before the connection is closed.
const MAX_VIOLATIONS = 50;

// Raised for bad client input; the message is safe to send back.
class SocketInputError extends Error {}

const parse = (schema, payload) => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join(".");
    throw new SocketInputError(
      path ? `${path}: ${issue.message}` : "Invalid payload"
    );
  }
  return result.data;
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

// Identity comes from the token only.
const authenticate = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) throw new Error("no token");

    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(userId).select("username isBlocked");
    if (!user || user.isBlocked) throw new Error("not allowed");

    socket.data.userId = user._id.toString();
    socket.data.username = user.username;
    next();
  } catch {
    next(new Error("Authentication failed"));
  }
};

const isChatMember = async (chatId, userId) =>
  Boolean(await Chat.exists({ _id: chatId, members: userId }));

export const setupSocketIO = (server, options = {}) => {
  const rateLimit = { ...DEFAULT_RATE_LIMIT, ...options.rateLimit };
  const origins = getCorsOrigins();

  const io = new Server(server, {
    cors: {
      origin: origins.length ? origins : false,
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: MAX_PACKET_BYTES,
  });

  // Connects in the background; never blocks connections.
  initRedis();

  io.use(authenticate);

  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    // Personal room, so events can be addressed to a user.
    socket.join(userRoom(userId));

    // Per-connection allowance of incoming events.
    let windowStart = Date.now();
    let count = 0;
    let violations = 0;
    socket.use(([event], next) => {
      const now = Date.now();
      if (now - windowStart >= rateLimit.windowMs) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      if (count <= rateLimit.max) {
        violations = 0;
        return next();
      }

      violations += 1;
      if (violations === 1) {
        socket.emit("socket-error", { event, message: "Rate limit exceeded" });
      }
      if (violations >= MAX_VIOLATIONS) socket.disconnect(true);
    });

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

    // Validates the chat id and checks that this user belongs to the chat.
    const requireMember = async (chatId) => {
      const id = parse(chatIdPayload, chatId);
      if (!(await isChatMember(id, userId))) {
        throw new SocketInputError("Not a member of this chat");
      }
      return id;
    };

    // ========== Chat Events ==========
    on("join-chat", async (chatId) => {
      const id = await requireMember(chatId);
      socket.join(chatRoom(id));
    });

    on("send-message", async (data) => {
      const { chatId, message } = parse(messagePayload, data);
      await requireMember(chatId);
      socket.to(chatRoom(chatId)).emit("receive-message", message);
    });

    on("group-message", async (data) => {
      const { chatId, message } = parse(messagePayload, data);
      await requireMember(chatId);
      io.to(chatRoom(chatId)).emit("receive-message", message);
    });

    on("typing", async (chatId) => {
      const id = await requireMember(chatId);
      socket.to(chatRoom(id)).emit("typing", userId);
    });

    on("stop-typing", async (chatId) => {
      const id = await requireMember(chatId);
      socket.to(chatRoom(id)).emit("stop-typing", userId);
    });

    // ========== Live Code Editor ==========
    on("join-live-code", async (data) => {
      const { chatId } = parse(joinLiveCodePayload, data);
      await requireMember(chatId);
      socket.join(liveCodeRoom(chatId));
      const doc = await LiveCode.findOne({ chatId });
      if (doc) {
        socket.emit("load-code", doc);
      }
    });

    on("code-change", async (data) => {
      const { chatId, code, language, fileName } = parse(
        codeChangePayload,
        data
      );
      await requireMember(chatId);

      const lang = language ?? "plaintext";
      const name = fileName ?? "main";

      await LiveCode.findOneAndUpdate(
        { chatId },
        { code, language: lang, fileName: name, updatedBy: userId },
        { upsert: true }
      );
      socket
        .to(liveCodeRoom(chatId))
        .emit("code-update", { code, language: lang, fileName: name });
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
