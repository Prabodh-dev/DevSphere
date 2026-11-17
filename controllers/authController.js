import mongoose from "mongoose";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import { signAccessToken } from "../utils/tokens.js";
import {
  findFamilyByToken,
  listActiveSessions,
  revokeAllForUser,
  revokeFamily,
  rotateSession,
  startSession,
} from "../utils/sessions.js";
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from "../utils/cookies.js";
import { config } from "../config/index.js";
import {
  HttpError,
  conflict,
  accountBlocked,
  forbidden,
  notFound,
  unauthorized,
} from "../utils/httpError.js";

// Compared against when the email is unknown so both failures take similar time.
const DUMMY_HASH = bcrypt.hashSync("placeholder-password", 10);

// Starts a session: sets the refresh cookie and returns the access token.
async function signIn(req, res, user, status) {
  const { familyId, refreshToken } = await startSession(user._id, req);
  setRefreshCookie(res, refreshToken);

  res.status(status).json({
    _id: user._id,
    username: user.username,
    email: user.email,
    token: signAccessToken(user._id.toString(), familyId),
    expiresIn: config.auth.accessTokenTtlSeconds,
  });
}

export const registerUser = async (req, res) => {
  const { username, email, password } = req.valid.body;

  if (await User.exists({ email })) throw conflict("Email already used");
  if (await User.exists({ username })) throw conflict("Username already taken");

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
  });

  await signIn(req, res, user, 201);
};

export const loginUser = async (req, res) => {
  const { email: rawEmail, password } = req.valid.body;
  const email = rawEmail.toLowerCase();

  // Accounts created before emails were normalised may be stored with their
  // original casing, so accept either form.
  const user = await User.findOne({
    email: mongoose.trusted({ $in: [email, rawEmail] }),
  });

  const match = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !match) throw unauthorized("Invalid credentials");

  if (user.isBlocked) throw accountBlocked();

  await signIn(req, res, user, 200);
};

// Exchanges the refresh cookie for a new access token and a rotated cookie.
export const refreshSession = async (req, res) => {
  const rawToken = readRefreshCookie(req);
  if (!rawToken) throw unauthorized("Refresh token required");

  let result;
  try {
    result = await rotateSession(rawToken, req, req.app.get("io"));
  } catch (err) {
    if (err instanceof HttpError) clearRefreshCookie(res);
    throw err;
  }

  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({
    token: signAccessToken(result.userId, result.familyId),
    expiresIn: config.auth.accessTokenTtlSeconds,
  });
};

export const logout = async (req, res) => {
  const rawToken = readRefreshCookie(req);
  if (rawToken) {
    const familyId = await findFamilyByToken(rawToken);
    if (familyId) await revokeFamily(familyId, req.app.get("io"));
  }
  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out" });
};

export const logoutAll = async (req, res) => {
  await revokeAllForUser(req.user._id, req.app.get("io"));
  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out everywhere" });
};

export const getSessions = async (req, res) => {
  const sessions = await listActiveSessions(req.user._id);
  res.status(200).json(
    sessions.map((session) => ({
      id: session.familyId,
      createdAt: session.familyStartedAt,
      lastUsedAt: session.createdAt,
      userAgent: session.userAgent,
      current: session.familyId === req.auth.sid,
    }))
  );
};

export const deleteSession = async (req, res) => {
  const familyId = req.valid.params.id;
  const active = await listActiveSessions(req.user._id);
  if (!active.some((session) => session.familyId === familyId)) {
    throw notFound("Session not found");
  }

  await revokeFamily(familyId, req.app.get("io"));
  if (familyId === req.auth.sid) clearRefreshCookie(res);
  res.status(200).json({ message: "Session revoked" });
};

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.valid.body;

  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw forbidden("Current password is incorrect");
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  // Every other login has to sign in again with the new password.
  await revokeAllForUser(user._id, req.app.get("io"), {
    exceptFamilyId: req.auth.sid,
  });

  res.status(200).json({ message: "Password changed" });
};
