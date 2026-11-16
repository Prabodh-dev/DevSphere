import express from "express";
import {
  registerUser,
  loginUser,
  refreshSession,
  logout,
  logoutAll,
  getSessions,
  deleteSession,
  changePassword,
} from "../controllers/authController.js";
import protect from "../middlewares/authMiddleware.js";
import { limiters } from "../middlewares/rateLimit.js";
import requireAllowedOrigin from "../middlewares/requireAllowedOrigin.js";
import validate from "../middlewares/validate.js";
import {
  registerBody,
  loginBody,
  changePasswordBody,
  sessionIdParams,
} from "../schemas/index.js";

const router = express.Router();

router.post(
  "/register",
  limiters.auth,
  validate({ body: registerBody }),
  registerUser
);
router.post("/login", limiters.auth, validate({ body: loginBody }), loginUser);

// Cookie based endpoints: only answered for allowed origins.
router.post("/refresh", limiters.refresh, requireAllowedOrigin, refreshSession);
router.post("/logout", requireAllowedOrigin, logout);

router.post("/logout-all", protect, logoutAll);
router.get("/sessions", protect, getSessions);
router.delete(
  "/sessions/:id",
  protect,
  validate({ params: sessionIdParams }),
  deleteSession
);
router.post(
  "/change-password",
  limiters.auth,
  protect,
  validate({ body: changePasswordBody }),
  changePassword
);

export default router;
