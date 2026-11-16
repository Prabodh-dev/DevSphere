import express from "express";
import { registerUser, loginUser } from "../controllers/authController.js";
import { limiters } from "../middlewares/rateLimit.js";
import validate from "../middlewares/validate.js";
import { registerBody, loginBody } from "../schemas/index.js";

const router = express.Router();

router.post(
  "/register",
  limiters.auth,
  validate({ body: registerBody }),
  registerUser
);
router.post("/login", limiters.auth, validate({ body: loginBody }), loginUser);

export default router;
