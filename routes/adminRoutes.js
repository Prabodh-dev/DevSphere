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
import requireAdmin from "../middlewares/requireAdmin.js";

const router = express.Router();

router.use(auth, requireAdmin);

router.get("/users", getAllUsers);
router.patch("/block/:id", blockUser);
router.patch("/unblock/:id", unblockUser);
router.get("/reports", getReports);
router.delete("/remove/:type/:id", deleteReportedItem);

export default router;
