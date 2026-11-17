import { logger, setLogSink } from "../../utils/logger.js";

// Captures the log lines written while a test runs. Tests are silent by
// default, so this turns the logger up and collects the JSON lines.
export function captureLogs(level = "trace") {
  const lines = [];
  const previous = logger.level;
  logger.level = level;
  setLogSink((chunk) => {
    for (const text of String(chunk).split("\n")) {
      if (text.trim()) lines.push(JSON.parse(text));
    }
  });
  return {
    lines,
    stop() {
      logger.level = previous;
      setLogSink(null);
    },
  };
}

export const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
