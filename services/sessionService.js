import mongoose from "mongoose";
import Session from "../models/Session.js";
import User from "../models/User.js";
import { HttpError, accountBlocked, unauthorized } from "../utils/httpError.js";
import { config } from "../config/index.js";
import { newRefreshToken, hashToken } from "../utils/tokens.js";
import { sessionRoom } from "../utils/rooms.js";
import { countRefresh } from "../utils/metrics.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Starts a new login (family) and returns its first refresh token.
// client is { userAgent, ip } of the request that signs in.
export async function startSession(userId, client) {
  const familyId = new mongoose.Types.ObjectId().toString();
  const now = new Date();
  const refreshToken = newRefreshToken();

  await Session.create({
    userId,
    familyId,
    familyStartedAt: now,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(
      now.getTime() + config.auth.refreshTokenTtlDays * DAY_MS
    ),
    ...client,
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

// Revokes every login of a user, optionally keeping one.
export async function revokeAllForUser(userId, io, { exceptFamilyId } = {}) {
  const filter = { userId, revokedAt: null };
  if (exceptFamilyId)
    filter.familyId = mongoose.trusted({ $ne: exceptFamilyId });

  const families = await Session.distinct("familyId", filter);
  await Session.updateMany(filter, { revokedAt: new Date() });
  closeSessionSockets(io, families);
}

// Active logins of a user, newest first.
export async function listActiveSessions(userId) {
  return Session.find({
    userId,
    revokedAt: null,
    expiresAt: mongoose.trusted({ $gt: new Date() }),
  })
    .sort({ familyStartedAt: -1 })
    .select("familyId familyStartedAt createdAt userAgent");
}

// A repeat of an already rotated token inside this window is treated as a
// parallel request, not as theft.
export const REUSE_GRACE_MS = 10 * 1000;

const invalid = () => unauthorized("Invalid refresh token");

// A token that was already used or revoked was presented. If it was rotated
// away a while ago, someone else may hold a copy, so the login is ended.
async function handleUsedToken(session, io) {
  const rotatedAgo = Date.now() - session.revokedAt.getTime();
  const error = invalid();
  if (session.replacedBy && rotatedAgo > REUSE_GRACE_MS) {
    await revokeFamily(session.familyId, io);
    error.reuseDetected = true;
  }
  throw error;
}

// Exchanges a refresh token for a new one in the same login. Returns the new
// refresh token, the login id and the user. Every outcome is counted.
export async function rotateSession(rawToken, client, io) {
  try {
    const result = await performRotation(rawToken, client, io);
    countRefresh("rotated");
    return result;
  } catch (err) {
    // Only refusals count; a failing database is not a refresh outcome.
    if (err instanceof HttpError) {
      countRefresh(err.reuseDetected ? "reuse_detected" : "rejected");
    }
    throw err;
  }
}

async function performRotation(rawToken, client, io) {
  const tokenHash = hashToken(rawToken);
  const session = await Session.findOne({ tokenHash });
  if (!session) throw invalid();

  if (session.revokedAt) return handleUsedToken(session, io);
  if (session.expiresAt <= new Date()) throw invalid();

  const user = await User.findById(session.userId).select("isBlocked");
  if (!user) throw invalid();
  if (user.isBlocked) {
    await revokeAllForUser(session.userId, io);
    throw accountBlocked();
  }

  // Only one request can claim a token, even when several arrive together.
  const now = new Date();
  const nextId = new mongoose.Types.ObjectId();
  const claimed = await Session.findOneAndUpdate(
    {
      _id: session._id,
      revokedAt: null,
      expiresAt: mongoose.trusted({ $gt: now }),
    },
    { revokedAt: now, replacedBy: nextId }
  );
  if (!claimed) {
    const latest = await Session.findOne({ tokenHash });
    if (latest?.revokedAt) return handleUsedToken(latest, io);
    throw invalid();
  }

  const refreshToken = newRefreshToken();
  await Session.create({
    _id: nextId,
    userId: session.userId,
    familyId: session.familyId,
    familyStartedAt: session.familyStartedAt,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(
      now.getTime() + config.auth.refreshTokenTtlDays * DAY_MS
    ),
    ...client,
  });

  return {
    refreshToken,
    familyId: session.familyId,
    userId: session.userId.toString(),
  };
}

// Looks up the login a refresh token belongs to (used or not).
export async function findFamilyByToken(rawToken) {
  const session = await Session.findOne({ tokenHash: hashToken(rawToken) });
  return session?.familyId;
}
