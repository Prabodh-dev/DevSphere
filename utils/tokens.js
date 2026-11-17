import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import { config } from "../config/index.js";

// Access token: short-lived JWT. `sid` names the session (family) it belongs to.
export const signAccessToken = (userId, sessionId) =>
  jwt.sign({ userId, sid: sessionId }, config.jwtSecret, {
    expiresIn: config.auth.accessTokenTtlSeconds,
  });

// Returns { userId, sid, exp } or throws when the token is invalid or expired.
export const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, config.jwtSecret);
  if (typeof payload.userId !== "string" || typeof payload.sid !== "string") {
    throw new Error("token has no session");
  }
  return { userId: payload.userId, sid: payload.sid, exp: payload.exp };
};

// Refresh token: 32 random bytes, only ever stored as a hash.
export const newRefreshToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
