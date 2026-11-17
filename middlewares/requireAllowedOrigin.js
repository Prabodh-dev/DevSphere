import { config } from "../config/index.js";
import { forbidden } from "../utils/httpError.js";

// Cookie-based endpoints only answer requests that come from an allowed
// origin. A missing Origin header is refused as well.
const requireAllowedOrigin = (req, res, next) => {
  const origin = req.get("origin");
  if (!origin || !config.corsOrigins.includes(origin)) {
    throw forbidden("Origin not allowed");
  }
  next();
};

export default requireAllowedOrigin;
