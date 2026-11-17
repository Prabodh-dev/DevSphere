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
import validate from "../middlewares/validate.js";
import {
  pageQuery,
  removeParams,
  reportsQuery,
  userIdParams,
} from "../schemas/index.js";

const router = express.Router();

router.use(auth, requireAdmin);

router.get("/users", validate({ query: pageQuery }), getAllUsers);
router.patch("/block/:id", validate({ params: userIdParams }), blockUser);
router.patch("/unblock/:id", validate({ params: userIdParams }), unblockUser);
router.get("/reports", validate({ query: reportsQuery }), getReports);
router.delete(
  "/remove/:type/:id",
  validate({ params: removeParams }),
  deleteReportedItem
);

export default router;
