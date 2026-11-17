// Used by the shutdown tests: installs the same guards as the server, then
// fails in the way named by the first argument.
import { createShutdown, installProcessGuards } from "../../utils/shutdown.js";
import { logger } from "../../utils/logger.js";

const mode = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 10000);

const shutdown = createShutdown({
  timeoutMs,
  close: async () => {
    logger.info("closing resources");
    if (mode.endsWith("-hang")) await new Promise(() => {});
    if (mode.endsWith("-failing-close")) throw new Error("close failed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    logger.info("resources closed");
  },
});
installProcessGuards({ shutdown });

logger.info("started");
if (mode.startsWith("reject")) Promise.reject(new Error("boom from a promise"));
if (mode.startsWith("throw")) {
  setTimeout(() => {
    throw new Error("boom from a timer");
  }, 20);
}
if (mode.startsWith("signal")) setTimeout(() => process.emit("SIGTERM"), 20);
process.on("SIGTERM", () => shutdown("SIGTERM"));
// Keeps the process alive like a server would.
setInterval(() => {}, 1000);
