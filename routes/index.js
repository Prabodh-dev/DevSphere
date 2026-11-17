import express from "express";
import authRoutes from "./authRoutes.js";
import profileRoutes from "./profileRoutes.js";
import userRoutes from "./userRoutes.js";
import chatRoutes from "./chatRoutes.js";
import groupRoutes from "./groupRoutes.js";
import statusRoutes from "./statusRoutes.js";
import snippetRoutes from "./snippetRoutes.js";
import liveCodeRoutes from "./liveCodeRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import adminRoutes from "./adminRoutes.js";
import reportRoutes from "./reportRoutes.js";

// Every router and where it is mounted under /api/v1.
export const mounts = [
  ["/auth", authRoutes],
  ["/profile", profileRoutes],
  ["/users", userRoutes],
  ["/chat", chatRoutes],
  ["/group", groupRoutes],
  ["/status", statusRoutes],
  ["/snippets", snippetRoutes],
  ["/live-code", liveCodeRoutes],
  ["/notifications", notificationRoutes],
  ["/admin", adminRoutes],
  ["/report", reportRoutes],
];

const v1 = express.Router();
for (const [prefix, router] of mounts) v1.use(prefix, router);

export default v1;
