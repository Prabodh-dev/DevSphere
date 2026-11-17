import { getRefreshTtlDays, isCookieSecure } from "../config/env.js";

export const REFRESH_COOKIE = "refresh_token";

// The cookie is only sent to the auth endpoints and is not readable by scripts.
const options = () => ({
  httpOnly: true,
  sameSite: "strict",
  secure: isCookieSecure(),
  path: "/api/v1/auth",
});

export const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, {
    ...options(),
    maxAge: getRefreshTtlDays() * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, options());
};

export const readRefreshCookie = (req) => {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== REFRESH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};
