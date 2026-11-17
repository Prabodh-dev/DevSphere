import { logger } from "./logger.js";

// Builds the function that stops the server. It closes the resources, then
// exits. It runs once, and exits non-zero if closing fails or takes longer
// than timeoutMs.
export function createShutdown({
  close,
  timeoutMs = 10000,
  exit = process.exit,
  log = logger,
}) {
  let started = false;

  return async function shutdown(reason, exitCode = 0) {
    if (started) return;
    started = true;
    log.info({ reason }, "shutting down");

    // Do not hang forever if something refuses to close.
    const timer = setTimeout(() => {
      log.error({ reason }, "shutdown timed out");
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    let code = exitCode;
    try {
      await close();
    } catch (err) {
      log.error({ err }, "Error during shutdown");
      code = 1;
    }
    clearTimeout(timer);
    exit(code);
  };
}

// Logs what could not be handled and shuts down with a failure code. After one
// of these the process is in an unknown state, so it must not keep running.
export function installProcessGuards({
  shutdown,
  log = logger,
  proc = process,
}) {
  proc.on("unhandledRejection", (reason) => {
    log.fatal({ err: reason }, "unhandledRejection");
    shutdown("unhandledRejection", 1);
  });
  proc.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaughtException");
    shutdown("uncaughtException", 1);
  });
}
