import pino from "pino";
import pinoPretty from "pino-pretty";
import { config } from "../config/index.js";

// Values that must never end up in a log line.
export const REDACTED_PATHS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "refreshToken",
  "accessToken",
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.token",
  "*.refreshToken",
  "*.accessToken",
];

// JSON lines go to stdout. Tests can capture them with setLogSink.
let sink = (chunk) => process.stdout.write(chunk);
const jsonDestination = { write: (chunk) => sink(chunk) };

export const setLogSink = (fn) => {
  sink = fn ?? ((chunk) => process.stdout.write(chunk));
};

const options = {
  level: config.log.level,
  redact: { paths: REDACTED_PATHS, censor: "[Redacted]" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
};

// JSON by default, readable text when LOG_PRETTY=true.
export const logger = pino(
  options,
  config.log.pretty
    ? pinoPretty({ colorize: false, ignore: "pid,hostname" })
    : jsonDestination
);

// For command line scripts: plain readable lines, written synchronously so
// nothing is lost when the script exits.
export const cliLogger = pino(
  { level: config.log.level, redact: options.redact },
  pinoPretty({ colorize: false, ignore: "pid,hostname,time", sync: true })
);
