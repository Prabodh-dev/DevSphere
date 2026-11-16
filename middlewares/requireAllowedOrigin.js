import { getCorsOrigins } from "../config/env.js";
import { forbidden } from "../utils/httpError.js";

// Cookie-based endpoints only answer requests that come from an allowed
// origin. A missing Origin header is refused as well.
const requireAllowedOrigin = (req, res, next) => {
  const origin = req.get("origin");
  if (!origin || !getCorsOrigins().includes(origin)) {
    throw forbidden("Origin not allowed");
  }
  next();
};

export default requireAllowedOrigin;
