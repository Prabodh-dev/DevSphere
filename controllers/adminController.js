import * as admin from "../services/adminService.js";

export const getAllUsers = async (req, res) => {
  const { docs, nextCursor } = await admin.listUsers(req.valid.query);
  res.status(200).json({ items: docs, nextCursor });
};

export const blockUser = async (req, res) => {
  await admin.setBlocked(
    req.valid.params.id,
    true,
    req.user._id,
    req.app.get("io")
  );
  res.status(200).json({ message: "User blocked" });
};

export const unblockUser = async (req, res) => {
  await admin.setBlocked(
    req.valid.params.id,
    false,
    req.user._id,
    req.app.get("io")
  );
  res.status(200).json({ message: "User unblocked" });
};

export const getReports = async (req, res) => {
  const { docs, nextCursor } = await admin.listReports(req.valid.query);
  res.status(200).json({ items: docs, nextCursor });
};

export const deleteReportedItem = async (req, res) => {
  const { type, id } = req.valid.params;
  await admin.removeReported(req.user, { type, id }, req.app.get("io"));
  res
    .status(200)
    .json({ message: type === "user" ? "user blocked" : `${type} deleted` });
};
