import * as auth from "../services/authService.js";
import { clientInfo } from "../utils/clientInfo.js";
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from "../utils/cookies.js";
import { HttpError } from "../utils/httpError.js";

// Sets the refresh cookie and answers with the access token.
function sendLogin(res, status, login) {
  setRefreshCookie(res, login.refreshToken);
  res.status(status).json({
    _id: login.user._id,
    username: login.user.username,
    email: login.user.email,
    token: login.accessToken,
    expiresIn: login.expiresIn,
  });
}

export const registerUser = async (req, res) => {
  const login = await auth.register(req.valid.body, clientInfo(req));
  sendLogin(res, 201, login);
};

export const loginUser = async (req, res) => {
  const login = await auth.login(req.valid.body, clientInfo(req));
  sendLogin(res, 200, login);
};

// Exchanges the refresh cookie for a new access token and a rotated cookie.
export const refreshSession = async (req, res) => {
  let result;
  try {
    result = await auth.refresh(
      readRefreshCookie(req),
      clientInfo(req),
      req.app.get("io")
    );
  } catch (err) {
    if (err instanceof HttpError) clearRefreshCookie(res);
    throw err;
  }

  setRefreshCookie(res, result.refreshToken);
  res
    .status(200)
    .json({ token: result.accessToken, expiresIn: result.expiresIn });
};

export const logout = async (req, res) => {
  await auth.logout(readRefreshCookie(req), req.app.get("io"));
  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out" });
};

export const logoutAll = async (req, res) => {
  await auth.logoutAll(req.user._id, req.app.get("io"));
  clearRefreshCookie(res);
  res.status(200).json({ message: "Logged out everywhere" });
};

export const getSessions = async (req, res) => {
  const sessions = await auth.listSessions(req.user._id);
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
  await auth.endSession(req.user._id, familyId, req.app.get("io"));
  if (familyId === req.auth.sid) clearRefreshCookie(res);
  res.status(200).json({ message: "Session revoked" });
};

export const changePassword = async (req, res) => {
  await auth.changePassword(
    req.user._id,
    req.valid.body,
    req.auth.sid,
    req.app.get("io")
  );
  res.status(200).json({ message: "Password changed" });
};
