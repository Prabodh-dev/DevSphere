import rateLimit from "express-rate-limit";
import { sendError } from "../utils/apiError.js";
import { config } from "../config/index.js";
import { SharedStore } from "../utils/rateLimitStore.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Set on a request once the general limiter has counted it.
const COUNTED = Symbol("generalRateLimitCounted");

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

export function createLimiters(options = {}) {
  // Counters are shared through Redis when it is available (see SharedStore).
  const base = (name) => ({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: tooMany,
    store: new SharedStore({ name }),
  });

  return {
    // Applied to every /api request. Routers that want the limit to be
    // visible where their routes are declared apply it too; a request is
    // still counted only once.
    general: rateLimit({
      ...base("general"),
      skip: (req) => {
        if (req[COUNTED]) return true;
        req[COUNTED] = true;
        return false;
      },
      windowMs: FIFTEEN_MINUTES,
      limit: options.generalMax ?? 300,
    }),
    // Login and registration.
    auth: rateLimit({
      ...base("auth"),
      windowMs: FIFTEEN_MINUTES,
      limit: options.authMax ?? 10,
    }),
    // Refresh token exchange.
    refresh: rateLimit({
      ...base("refresh"),
      windowMs: FIFTEEN_MINUTES,
      limit: options.refreshMax ?? 60,
    }),
    // The public snippet highlighter.
    highlight: rateLimit({
      ...base("highlight"),
      windowMs: 60 * 1000,
      limit: options.highlightMax ?? 30,
    }),
  };
}

export const limiters = createLimiters({
  generalMax: config.rateLimit.general,
  authMax: config.rateLimit.auth,
  refreshMax: config.rateLimit.refresh,
  highlightMax: config.rateLimit.highlight,
});
