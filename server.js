import "dotenv/config";
import mongoose from "mongoose";
import http from "http";
import app from "./app.js";
import { setupSocketIO } from "./socket.js";
import { closeRedis } from "./config/redis.js";
import { getMissingEnv } from "./config/env.js";

const missing = getMissingEnv();
if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(", ")}`
  );
  process.exit(1);
}

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
let io;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10000).unref();

  try {
    await new Promise((resolve) => {
      io.close(resolve);
      server.closeIdleConnections?.();
    });
    await closeRedis();
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err.message);
    process.exit(1);
  }
}

async function start() {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log("MongoDB connected");

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB error:", err.message);
  });

  io = setupSocketIO(server);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server running on port ${PORT}`);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
