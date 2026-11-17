// socket.js
import { Server } from "socket.io";
import { getRedisClient, initRedis } from "./config/redis.js";
import { config } from "./config/index.js";
import Chat from "./models/Chat.js";
import LiveCode from "./models/LiveCode.js";
import User from "./models/User.js";
import {
  chatRoom,
  liveCodeRoom,
  sessionRoom,
  userRoom,
} from "./utils/rooms.js";
import { verifyAccessToken } from "./utils/tokens.js";
import { errorBody } from "./utils/apiError.js";
import { isSessionActive } from "./services/sessionService.js";
import {
  chatIdPayload,
  codeChangePayload,
  joinLiveCodePayload,
  messagePayload,
} from "./schemas/socket.js";

// setTimeout cannot wait longer than about 24 days.
const MAX_TIMER_MS = 2 ** 31 - 1;

// Largest single packet the transport accepts.
const MAX_PACKET_BYTES = 512 * 1024;

const DEFAULT_RATE_LIMIT = { max: 100, windowMs: 10 * 1000 };
// Events dropped in a row before the connection is closed.
const MAX_VIOLATIONS = 50;

// Raised for bad client input; the message is safe to send back.
class SocketInputError extends Error {
  constructor(message, code = "VALIDATION_ERROR", details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// socket-error payload: { event, error: { code, message, details? } }
const socketError = (event, code, message, details) => ({
  event,
  ...errorBody(code, message, details),
});

const parse = (schema, payload) => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new SocketInputError(
      "Invalid payload",
      "VALIDATION_ERROR",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }))
    );
  }
  return result.data;
};

// Presence is best effort: a Redis problem must never break a socket.
const setPresence = async (command, userId) => {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client[command](`${config.redis.keyPrefix}onlineUsers`, userId);
  } catch (err) {
    console.warn(`Redis ${command} failed:`, err.message);
  }
};

// Identity comes from the token only.
const authenticate = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) throw new Error("no token");

    const { userId, sid, exp } = verifyAccessToken(token);
    const user = await User.findById(userId).select("username isBlocked");
    if (!user || user.isBlocked) throw new Error("not allowed");
    if (!(await isSessionActive(sid, user._id))) throw new Error("not allowed");

    socket.data.userId = user._id.toString();
    socket.data.username = user.username;
    socket.data.sessionId = sid;
    socket.data.expiresAt = exp * 1000;
    next();
  } catch {
    next(new Error("Authentication failed"));
  }
};

const isChatMember = async (chatId, userId) =>
  Boolean(await Chat.exists({ _id: chatId, members: userId }));

export const setupSocketIO = (server, options = {}) => {
  const rateLimit = { ...DEFAULT_RATE_LIMIT, ...options.rateLimit };
  const origins = config.corsOrigins;

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

    // Personal room, so events can be addressed to a user, and a room for the
    // login so it can be closed when the login ends.
    socket.join(userRoom(userId));
    socket.join(sessionRoom(socket.data.sessionId));

    // The connection lasts as long as the access token it was opened with. The
    // client reconnects with a fresh token after refreshing.
    const closeAt = setTimeout(
      () => socket.disconnect(true),
      Math.min(Math.max(socket.data.expiresAt - Date.now(), 0), MAX_TIMER_MS)
    );
    socket.on("disconnect", () => clearTimeout(closeAt));

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
        socket.emit(
          "socket-error",
          socketError(event, "RATE_LIMITED", "Rate limit exceeded")
        );
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
            socket.emit(
              "socket-error",
              socketError(event, err.code, err.message, err.details)
            );
          } else {
            console.error(`Socket event "${event}" failed:`, err);
            socket.emit(
              "socket-error",
              socketError(event, "INTERNAL_ERROR", "Request failed")
            );
          }
        }
      });
    };

    // Validates the chat id and checks that this user belongs to the chat.
    const requireMember = async (chatId) => {
      const id = parse(chatIdPayload, chatId);
      if (!(await isChatMember(id, userId))) {
        throw new SocketInputError("Not a member of this chat", "FORBIDDEN");
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

      const update = {
        code,
        language: lang,
        fileName: name,
        updatedBy: userId,
      };
      try {
        await LiveCode.findOneAndUpdate({ chatId }, update, { upsert: true });
      } catch (err) {
        // Two first edits arriving together: the other one created the
        // document, so this one is now a plain update.
        if (err.code !== 11000) throw err;
        await LiveCode.findOneAndUpdate({ chatId }, update);
      }
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
