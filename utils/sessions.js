import mongoose from "mongoose";
import Session from "../models/Session.js";
import { getRefreshTtlDays } from "../config/env.js";
import { newRefreshToken, hashToken } from "./tokens.js";
import { sessionRoom } from "./rooms.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const clientInfo = (req) => ({
  userAgent: String(req.get("user-agent") ?? "").slice(0, 200),
  ip: String(req.ip ?? ""),
});

// Starts a new login (family) and returns its first refresh token.
export async function startSession(userId, req) {
  const familyId = new mongoose.Types.ObjectId().toString();
  const now = new Date();
  const refreshToken = newRefreshToken();

  await Session.create({
    userId,
    familyId,
    familyStartedAt: now,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(now.getTime() + getRefreshTtlDays() * DAY_MS),
    ...clientInfo(req),
  });

  return { familyId, refreshToken };
}

// True while the family still has an unused, unexpired refresh token.
export const isSessionActive = async (familyId, userId) =>
  Boolean(
    await Session.exists({
      familyId,
      userId,
      revokedAt: null,
      expiresAt: mongoose.trusted({ $gt: new Date() }),
    })
  );

// Disconnects sockets that were opened with this session's access token.
export const closeSessionSockets = (io, familyIds) => {
  if (!io) return;
  for (const familyId of familyIds) {
    io.in(sessionRoom(familyId)).disconnectSockets(true);
  }
};

// Revokes one login. Returns true if anything was still active.
export async function revokeFamily(familyId, io) {
  const result = await Session.updateMany(
    { familyId, revokedAt: null },
    { revokedAt: new Date() }
  );
  closeSessionSockets(io, [familyId]);
  return result.modifiedCount > 0;
}
