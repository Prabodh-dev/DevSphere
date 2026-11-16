import express from "express";
import { registerUser, loginUser } from "../controllers/authController.js";
import validate from "../middlewares/validate.js";
import { registerBody, loginBody } from "../schemas/index.js";

const router = express.Router();

router.post("/register", validate({ body: registerBody }), registerUser);
router.post("/login", validate({ body: loginBody }), loginUser);

export default router;
