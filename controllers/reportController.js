import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import User from "../models/User.js";
import { badRequest, conflict, notFound } from "../utils/httpError.js";

// Whether the reported thing exists and the reporter is allowed to see it.
async function targetIsReachable(type, id, reporterId) {
  if (type === "user") return Boolean(await User.exists({ _id: id }));
  if (type === "status") return Boolean(await Status.exists({ _id: id }));

  const message = await Message.findById(id).select("chat");
  if (!message) return false;
  return Boolean(await Chat.exists({ _id: message.chat, members: reporterId }));
}

export const createReport = async (req, res) => {
  const { targetType, targetId, reason } = req.valid.body;

  if (targetType === "user" && targetId === req.user._id.toString()) {
    throw badRequest("You can't report yourself");
  }
  if (!(await targetIsReachable(targetType, targetId, req.user._id))) {
    throw notFound("Reported item not found");
  }

  const alreadyReported = await Report.exists({
    reportedBy: req.user._id,
    targetType,
    targetId,
    status: "open",
  });
  if (alreadyReported) throw conflict("You already reported this");

  try {
    const report = await Report.create({
      reportedBy: req.user._id,
      targetType,
      targetId,
      reason,
    });
    res.status(201).json(report);
  } catch (err) {
    if (err.code === 11000) throw conflict("You already reported this");
    throw err;
  }
};
