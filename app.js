import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";

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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res
    .status(dbUp ? 200 : 503)
    .json({ status: dbUp ? "ok" : "unavailable", db: dbUp ? "up" : "down" });
});

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

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
