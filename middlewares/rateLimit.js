import rateLimit from "express-rate-limit";
import { sendError } from "../utils/apiError.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const tooMany = (req, res) => {
  const retryAfter = Number(res.getHeader("Retry-After"));
  sendError(
    res,
    429,
    "RATE_LIMITED",
    "Too many requests, please try again later",
    Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : undefined
  );
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function createLimiters(options = {}) {
  const base = {
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany,
  };

  return {
    // Applied to every /api request.
    general: rateLimit({
      ...base,
      windowMs: FIFTEEN_MINUTES,
      limit: options.generalMax ?? 300,
    }),
    // Login and registration.
    auth: rateLimit({
      ...base,
      windowMs: FIFTEEN_MINUTES,
      limit: options.authMax ?? 10,
    }),
    // Refresh token exchange.
    refresh: rateLimit({
      ...base,
      windowMs: FIFTEEN_MINUTES,
      limit: options.refreshMax ?? 60,
    }),
    // The public snippet highlighter.
    highlight: rateLimit({
      ...base,
      windowMs: 60 * 1000,
      limit: options.highlightMax ?? 30,
    }),
  };
}

export const limitersFromEnv = (env = process.env) =>
  createLimiters({
    generalMax: toNumber(env.RATE_LIMIT_MAX, 300),
    authMax: toNumber(env.AUTH_RATE_LIMIT_MAX, 10),
    refreshMax: toNumber(env.REFRESH_RATE_LIMIT_MAX, 60),
    highlightMax: toNumber(env.HIGHLIGHT_RATE_LIMIT_MAX, 30),
  });

export const limiters = limitersFromEnv();
