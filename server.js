import mongoose from "mongoose";
import http from "http";
import app from "./app.js";
import { setupSocketIO } from "./socket.js";
import { closeRedis } from "./config/redis.js";
import { flushLiveCode } from "./services/liveCodeService.js";
import { config, getConfigWarnings, getEnvProblems } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { createShutdown, installProcessGuards } from "./utils/shutdown.js";
import { cleanupExpiredStatusMedia } from "./utils/mediaCleanup.js";
import { removeNotificationsOfMissingStatuses } from "./services/statusService.js";

const problems = getEnvProblems();
if (problems.length > 0) {
  logger.fatal({ problems }, "Invalid environment");
  process.exit(1);
}

for (const warning of getConfigWarnings()) logger.warn(warning);

const PORT = config.port;
const server = http.createServer(app);
let io;

const shutdown = createShutdown({
  close: async () => {
    if (io) {
      await new Promise((resolve) => {
        io.close(resolve);
        server.closeIdleConnections?.();
      });
    }
    // Edits waiting for their save go to the database before it closes.
    await flushLiveCode();
    await closeRedis();
    await mongoose.connection.close();
  },
});

async function start() {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  logger.info("MongoDB connected");

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "MongoDB error");
  });

  io = setupSocketIO(server);
  app.set("io", io);

  // Remove stored files of statuses that are no longer visible.
  const runCleanup = () =>
    Promise.all([
      cleanupExpiredStatusMedia(),
      removeNotificationsOfMissingStatuses(),
    ]).catch((err) =>
      logger.warn({ err: err.message }, "Status cleanup failed")
    );
  runCleanup();
  setInterval(runCleanup, 10 * 60 * 1000).unref();

  await new Promise((resolve) => server.listen(PORT, resolve));
  logger.info({ port: PORT }, "Server running");
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
installProcessGuards({ shutdown });

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
