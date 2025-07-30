import dotenv from "dotenv";
dotenv.config();

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import { setupSocketIO } from "./socket.js";

const app = express();
app.use(cors());
app.use(express.json());

import authRoutes from "./routes/authRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import groupRoutes from "./routes/groupRoutes.js";
import statusRoutes from "./routes/statusRoutes.js";
import snippetRoutes from "./routes/snippetRoutes.js";
import liveCodeRoutes from "./routes/liveCodeRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/group", groupRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/snippets", snippetRoutes);
app.use("/api/live-code", liveCodeRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/report", reportRoutes);

const server = http.createServer(app);
setupSocketIO(server);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log(" MongoDB Connected.....");
    console.log("Spanning in to DevSphere server");
    server.listen(5000, () => console.log(" Server running on port 5000"));
  })
  .catch((err) => console.error(" Mongo Error", err));
