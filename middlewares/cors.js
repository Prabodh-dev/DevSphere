import cors from "cors";
import { config } from "../config/index.js";

const METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
// The request headers the API reads.
const ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-Request-Id"];
// Response headers a browser client may read: rate limiting and the request id.
const EXPOSED_HEADERS = [
  "RateLimit",
  "RateLimit-Policy",
  "Retry-After",
  "X-Request-Id",
];
const PREFLIGHT_MAX_AGE_SECONDS = 600;

// Only origins in CORS_ORIGINS get CORS headers, and credentials are only
// allowed for them. Everyone else gets no CORS headers at all.
export const corsMiddleware = cors((req, callback) => {
  const origin = req.get("origin");

  if (!origin || !config.corsOrigins.includes(origin)) {
    return callback(null, { origin: false });
  }

  callback(null, {
    origin,
    credentials: true,
    methods: METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
});
