import { Server } from "socket.io";
import redisClient from "./config/redis.js";

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

    await redisClient.sAdd("onlineUsers", userId);
    console.log(` User ${userId} connected`);
    socket.broadcast.emit("user-online", userId);

    socket.on("join-chat", (chatId) => {
      socket.join(chatId);
      console.log(` User ${userId} joined chat ${chatId}`);
    });

    socket.on("send-message", (data) => {
      const { chatId, message } = data;
      socket.to(chatId).emit("receive-message", message);
    });

    socket.on("typing", (chatId) => {
      socket.to(chatId).emit("typing", userId);
    });

    socket.on("stop-typing", (chatId) => {
      socket.to(chatId).emit("stop-typing", userId);
    });

    socket.on("disconnect", async () => {
      await redisClient.sRem("onlineUsers", userId);
      socket.broadcast.emit("user-offline", userId);
      console.log(` User ${userId} disconnected`);
    });
  });
};
