// routes/reportRoutes.js
import express from "express";
import auth from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validate.js";
import Report from "../models/Report.js";
import { reportBody } from "../schemas/index.js";

const router = express.Router();

router.post("/", auth, validate({ body: reportBody }), async (req, res) => {
  const { targetType, targetId, reason } = req.valid.body;

  const report = await Report.create({
    reportedBy: req.user._id,
    targetType,
    targetId,
    reason,
  });

  res.status(201).json(report);
});

export default router;
