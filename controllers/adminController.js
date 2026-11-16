import User from "../models/User.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import Message from "../models/Message.js";
import { notFound } from "../utils/httpError.js";
import { requireObjectId, requireOneOf } from "../utils/validate.js";

const setBlocked = async (id, isBlocked) => {
  const userId = requireObjectId(id, "user id");
  const user = await User.findById(userId);
  if (!user) throw notFound("User not found");

  user.isBlocked = isBlocked;
  await user.save();
};

export const getAllUsers = async (req, res) => {
  const users = await User.find().select("-password");
  res.status(200).json(users);
};

export const blockUser = async (req, res) => {
  await setBlocked(req.params.id, true);
  res.status(200).json({ message: "User blocked" });
};

export const unblockUser = async (req, res) => {
  await setBlocked(req.params.id, false);
  res.status(200).json({ message: "User unblocked" });
};

export const getReports = async (req, res) => {
  const reports = await Report.find().populate("reportedBy", "username");
  res.status(200).json(reports);
};

export const deleteReportedItem = async (req, res) => {
  const { type, id } = req.params;
  requireOneOf(type, ["status", "message"], "type");
  requireObjectId(id, "id");

  const Model = type === "status" ? Status : Message;
  const deleted = await Model.findByIdAndDelete(id);
  if (!deleted) throw notFound(`${type} not found`);

  res.status(200).json({ message: `${type} deleted` });
};
