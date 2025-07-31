// socket.js
import { Server } from "socket.io";
import getRedisClient, { initRedis } from "./config/redis.js";
import LiveCode from "./models/LiveCode.js";

export const setupSocketIO = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", async (socket) => {
    const userId = socket.handshake.query.userId;
    if (!userId) return socket.disconnect();

    //  Initialize Redis (safe lazy connection)
    await initRedis();
    const redisClient = getRedisClient();

    await redisClient.sAdd("onlineUsers", userId);
    console.log(`User ${userId} connected`);
    socket.broadcast.emit("user-online", userId);

    // ========== Chat Events ==========
    socket.on("join-chat", (chatId) => {
      socket.join(chatId);
      console.log(`User ${userId} joined chat ${chatId}`);
    });

    socket.on("send-message", (data) => {
      const { chatId, message } = data;
      socket.to(chatId).emit("receive-message", message);
    });

    socket.on("group-message", (data) => {
      const { chatId, message } = data;
      io.to(chatId).emit("receive-message", message);
    });

    socket.on("typing", (chatId) => {
      socket.to(chatId).emit("typing", userId);
    });

    socket.on("stop-typing", (chatId) => {
      socket.to(chatId).emit("stop-typing", userId);
    });

    // ========== Live Code Editor ==========
    socket.on("join-live-code", async ({ chatId }) => {
      socket.join(`live-${chatId}`);
      const doc = await LiveCode.findOne({ chatId });
      if (doc) {
        socket.emit("load-code", doc);
      }
    });

    socket.on(
      "code-change",
      async ({ chatId, code, language, fileName, userId }) => {
        await LiveCode.findOneAndUpdate(
          { chatId },
          { code, language, fileName, updatedBy: userId },
          { upsert: true }
        );
        socket
          .to(`live-${chatId}`)
          .emit("code-update", { code, language, fileName });
      }
    );

    // ========== Notifications ==========
    socket.on("send-notification", ({ toUserId, notification }) => {
      io.to(toUserId).emit("receive-notification", notification);
    });

    // ========== Disconnect ==========
    socket.on("disconnect", async () => {
      await redisClient.sRem("onlineUsers", userId);
      socket.broadcast.emit("user-offline", userId);
      console.log(`User ${userId} disconnected`);
    });
  });
};
