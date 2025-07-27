// routes/adminRoutes.js
import express from "express";
import {
  getAllUsers,
  blockUser,
  unblockUser,
  getReports,
  deleteReportedItem,
} from "../controllers/adminController.js";
import auth from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/users", auth, getAllUsers);
router.patch("/block/:id", auth, blockUser);
router.patch("/unblock/:id", auth, unblockUser);
router.get("/reports", auth, getReports);
router.delete("/remove/:type/:id", auth, deleteReportedItem);

export default router;
