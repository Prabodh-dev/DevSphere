import mongoose from "mongoose";
import http from "http";
import app from "./app.js";
import { setupSocketIO } from "./socket.js";
import { closeRedis } from "./config/redis.js";
import { config, getEnvProblems } from "./config/index.js";
import { cleanupExpiredStatusMedia } from "./utils/mediaCleanup.js";

const problems = getEnvProblems();
if (problems.length > 0) {
  console.error(`Invalid environment:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const PORT = config.port;
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
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log("MongoDB connected");

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB error:", err.message);
  });

  io = setupSocketIO(server);
  app.set("io", io);

  // Remove stored files of statuses that are no longer visible.
  const runCleanup = () =>
    cleanupExpiredStatusMedia().catch((err) =>
      console.warn("Status media cleanup failed:", err.message)
    );
  runCleanup();
  setInterval(runCleanup, 10 * 60 * 1000).unref();

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Server running on port ${PORT}`);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
