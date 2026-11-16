import User from "../models/User.js";
import { verifyAccessToken } from "../utils/tokens.js";
import { isSessionActive } from "../utils/sessions.js";

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  let decoded;
  try {
    const token = authHeader.split(" ")[1];
    decoded = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  // Database problems are not the caller's fault; let the error handler log them.
  const user = await User.findById(decoded.userId).select("-password");
  if (!user) return res.status(401).json({ message: "User not found" });

  if (user.isBlocked) {
    return res.status(403).json({ message: "Account is blocked" });
  }

  if (!(await isSessionActive(decoded.sid, user._id))) {
    return res.status(401).json({ message: "Invalid token" });
  }

  req.user = user;
  req.auth = { sid: decoded.sid, exp: decoded.exp };
  next();
};

export default protect;
