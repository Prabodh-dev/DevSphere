import User from "../models/User.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import Message from "../models/Message.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { deleteMedia } from "../utils/s3Utils.js";
import { userRoom } from "../utils/rooms.js";
import { revokeAllForUser } from "../utils/sessions.js";
import { refreshLatestMessage } from "../utils/chatPreview.js";

const setBlocked = async (userId, isBlocked, actingUserId, io) => {
  if (isBlocked && userId === actingUserId.toString()) {
    throw badRequest("You can't block your own account");
  }
  const user = await User.findById(userId);
  if (!user) throw notFound("User not found");

  user.isBlocked = isBlocked;
  await user.save();

  // A blocked user is signed out everywhere and loses open connections.
  if (isBlocked) {
    await revokeAllForUser(user._id, io);
    io?.in(userRoom(userId)).disconnectSockets(true);
  }
};

export const getAllUsers = async (req, res) => {
  const users = await User.find().select("-password");
  res.status(200).json(users);
};

export const blockUser = async (req, res) => {
  await setBlocked(req.valid.params.id, true, req.user._id, req.app.get("io"));
  res.status(200).json({ message: "User blocked" });
};

export const unblockUser = async (req, res) => {
  await setBlocked(req.valid.params.id, false, req.user._id, req.app.get("io"));
  res.status(200).json({ message: "User unblocked" });
};

export const getReports = async (req, res) => {
  const { status } = req.valid.query;
  const filter = status === "all" ? {} : { status };

  const reports = await Report.find(filter)
    .sort({ createdAt: -1 })
    .populate("reportedBy", "username");
  res.status(200).json(reports);
};

// Removes what was reported. A user is blocked rather than deleted.
export const deleteReportedItem = async (req, res) => {
  const { type, id } = req.valid.params;
  const io = req.app.get("io");

  if (type === "user") {
    await setBlocked(id, true, req.user._id, io);
  } else {
    const Model = type === "status" ? Status : Message;
    const deleted = await Model.findByIdAndDelete(id);
    if (!deleted) throw notFound(`${type} not found`);

    if (type === "status") await deleteMedia(deleted.mediaKey);
    if (type === "message")
      await refreshLatestMessage(deleted.chat, deleted._id);
  }

  // The reports stay on record, marked as handled.
  await Report.updateMany(
    { targetType: type, targetId: id, status: "open" },
    { status: "resolved", resolvedAt: new Date(), resolvedBy: req.user._id }
  );

  res
    .status(200)
    .json({ message: type === "user" ? "user blocked" : `${type} deleted` });
};
