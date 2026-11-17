import mongoose from "mongoose";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import { config } from "../config/index.js";
import {
  accountBlocked,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "../utils/httpError.js";
import { countRefresh } from "../utils/metrics.js";
import { signAccessToken } from "../utils/tokens.js";
import {
  findFamilyByToken,
  listActiveSessions,
  revokeAllForUser,
  revokeFamily,
  rotateSession,
  startSession,
} from "./sessionService.js";

// Compared against when the email is unknown so both failures take similar time.
const DUMMY_HASH = bcrypt.hashSync("placeholder-password", 10);

// Starts a login for a user: a refresh token and an access token for it.
async function startLogin(user, client) {
  const { familyId, refreshToken } = await startSession(user._id, client);
  return {
    user,
    refreshToken,
    accessToken: signAccessToken(user._id.toString(), familyId),
    expiresIn: config.auth.accessTokenTtlSeconds,
  };
}

export async function register({ username, email, password }, client) {
  if (await User.exists({ email })) throw conflict("Email already used");
  if (await User.exists({ username })) throw conflict("Username already taken");

  const user = await User.create({
    username,
    email,
    password: await bcrypt.hash(password, 10),
  });

  return startLogin(user, client);
}

export async function login({ email: rawEmail, password }, client) {
  const email = rawEmail.toLowerCase();

  // Accounts created before emails were normalised may be stored with their
  // original casing, so accept either form.
  const user = await User.findOne({
    email: mongoose.trusted({ $in: [email, rawEmail] }),
  });

  const match = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !match) throw unauthorized("Invalid credentials");

  if (user.isBlocked) throw accountBlocked();

  return startLogin(user, client);
}

// Exchanges a refresh token for a new access token and a rotated refresh token.
export async function refresh(rawToken, client, io) {
  if (!rawToken) {
    countRefresh("rejected");
    throw unauthorized("Refresh token required");
  }

  const result = await rotateSession(rawToken, client, io);
  return {
    accessToken: signAccessToken(result.userId, result.familyId),
    refreshToken: result.refreshToken,
    expiresIn: config.auth.accessTokenTtlSeconds,
  };
}

// Ends the login a refresh token belongs to. Without a token nothing happens.
export async function logout(rawToken, io) {
  if (!rawToken) return;
  const familyId = await findFamilyByToken(rawToken);
  if (familyId) await revokeFamily(familyId, io);
}

export const logoutAll = (userId, io) => revokeAllForUser(userId, io);

export const listSessions = (userId) => listActiveSessions(userId);

// Ends one of the user's logins.
export async function endSession(userId, familyId, io) {
  const active = await listActiveSessions(userId);
  if (!active.some((session) => session.familyId === familyId)) {
    throw notFound("Session not found");
  }
  await revokeFamily(familyId, io);
}

// Changes the password and ends every login except the current one.
export async function changePassword(
  userId,
  { currentPassword, newPassword },
  keepFamilyId,
  io
) {
  const user = await User.findById(userId);
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw forbidden("Current password is incorrect");
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  await revokeAllForUser(user._id, io, { exceptFamilyId: keepFamilyId });
}
