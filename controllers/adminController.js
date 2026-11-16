import User from "../models/User.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import Message from "../models/Message.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { deleteMedia } from "../utils/s3Utils.js";

const setBlocked = async (userId, isBlocked, actingUserId) => {
  if (isBlocked && userId === actingUserId.toString()) {
    throw badRequest("You can't block your own account");
  }
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
  await setBlocked(req.valid.params.id, true, req.user._id);
  res.status(200).json({ message: "User blocked" });
};

export const unblockUser = async (req, res) => {
  await setBlocked(req.valid.params.id, false, req.user._id);
  res.status(200).json({ message: "User unblocked" });
};

export const getReports = async (req, res) => {
  const reports = await Report.find().populate("reportedBy", "username");
  res.status(200).json(reports);
};

export const deleteReportedItem = async (req, res) => {
  const { type, id } = req.valid.params;

  const Model = type === "status" ? Status : Message;
  const deleted = await Model.findByIdAndDelete(id);
  if (!deleted) throw notFound(`${type} not found`);

  if (type === "status") await deleteMedia(deleted.mediaKey);
  await Report.deleteMany({ targetType: type, targetId: id });

  res.status(200).json({ message: `${type} deleted` });
};
