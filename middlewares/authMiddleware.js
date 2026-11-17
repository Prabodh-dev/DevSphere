import User from "../models/User.js";
import { accountBlocked, unauthorized } from "../utils/httpError.js";
import { verifyAccessToken } from "../utils/tokens.js";
import { isSessionActive } from "../services/sessionService.js";

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("No token provided");
  }

  let decoded;
  try {
    const token = authHeader.split(" ")[1];
    decoded = verifyAccessToken(token);
  } catch {
    throw unauthorized("Invalid token");
  }

  // Database problems are not the caller's fault; let the error handler log them.
  const user = await User.findById(decoded.userId).select("-password");
  if (!user) throw unauthorized("User not found");

  if (user.isBlocked) {
    throw accountBlocked();
  }

  if (!(await isSessionActive(decoded.sid, user._id))) {
    throw unauthorized("Invalid token");
  }

  req.user = user;
  req.auth = { sid: decoded.sid, exp: decoded.exp };
  next();
};

export default protect;
