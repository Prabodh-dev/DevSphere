// Used by the logging tests: writes a few log lines with the settings it was
// started with.
import { logger } from "../../utils/logger.js";

logger.debug("debug line");
logger.info({ answer: 42 }, "info line");
logger.warn("warn line");
logger.info({ password: "hunter2", user: { token: "abc123" } }, "secret line");
