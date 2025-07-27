// routes/reportRoutes.js
import express from "express";
import auth from "../middlewares/authMiddleware.js";
import Report from "../models/Report.js";

const router = express.Router();

router.post("/", auth, async (req, res) => {
  const { targetType, targetId, reason } = req.body;

  try {
    const report = await Report.create({
      reportedBy: req.user._id,
      targetType,
      targetId,
      reason,
    });

    res.status(201).json(report);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to submit report", error: err.message });
  }
});

export default router;
