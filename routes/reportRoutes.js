// routes/reportRoutes.js
import express from "express";
import auth from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import { createReport } from "../controllers/reportController.js";
import { reportBody } from "../schemas/index.js";

const router = express.Router();

router.post("/", auth, validate({ body: reportBody }), createReport);

export default router;
