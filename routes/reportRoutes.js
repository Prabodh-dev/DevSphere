// routes/reportRoutes.js
import express from "express";
import auth from "../middlewares/authMiddleware.js";
import Report from "../models/Report.js";
import {
  requireObjectId,
  requireOneOf,
  requireString,
} from "../utils/validate.js";

const router = express.Router();

router.post("/", auth, async (req, res) => {
  const body = req.body ?? {};

  const report = await Report.create({
    reportedBy: req.user._id,
    targetType: requireOneOf(
      body.targetType,
      ["message", "status", "user"],
      "targetType"
    ),
    targetId: requireObjectId(body.targetId, "targetId"),
    reason: requireString(body.reason, "reason", { max: 1000 }),
  });

  res.status(201).json(report);
});

export default router;
