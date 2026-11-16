import { forbidden } from "../utils/httpError.js";

// Must run after the auth middleware, which sets req.user.
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    throw forbidden("Admin access required");
  }
  next();
};

export default requireAdmin;
