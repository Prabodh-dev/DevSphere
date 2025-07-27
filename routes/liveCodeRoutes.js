// routes/liveCodeRoutes.js
import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import LiveCode from "../models/LiveCode.js";

const router = express.Router();

router.get("/:chatId", authMiddleware, async (req, res) => {
  try {
    const codeDoc = await LiveCode.findOne({ chatId: req.params.chatId });
    res.status(200).json(codeDoc);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch live code", error: err.message });
  }
});

export default router;
