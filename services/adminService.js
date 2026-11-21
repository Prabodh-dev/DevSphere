import Message from "../models/Message.js";
import Report from "../models/Report.js";
import Status from "../models/Status.js";
import User from "../models/User.js";
import { refreshLatestMessage } from "../utils/chatPreview.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { paginate } from "../utils/pagination.js";
import { disconnectUser } from "../utils/socketOps.js";
import { deleteMedia } from "../utils/s3Utils.js";
import { revokeAllForUser } from "./sessionService.js";

// Blocks or unblocks an account. A blocked user is signed out everywhere and
// loses open connections.
export async function setBlocked(userId, isBlocked, actingUserId, io) {
  if (isBlocked && userId === actingUserId.toString()) {
    throw badRequest("You can't block your own account");
  }
  const user = await User.findById(userId);
  if (!user) throw notFound("User not found");

  user.isBlocked = isBlocked;
  await user.save();

  if (isBlocked) {
    await revokeAllForUser(user._id, io);
    disconnectUser(io, userId);
  }
}

// All users, newest first, without their password hashes.
export function listUsers({ limit, cursor }) {
  return paginate(User, {
    sortField: "_id",
    direction: -1,
    limit,
    cursor,
    build: (query) => query.select("-password"),
  });
}

export function listReports({ status, limit, cursor }) {
  return paginate(Report, {
    filter: status === "all" ? {} : { status },
    sortField: "createdAt",
    limit,
    cursor,
    build: (query) => query.populate("reportedBy", "username"),
  });
}

// Removes what was reported. A user is blocked rather than deleted. The open
// reports about it stay on record, marked as handled.
export async function removeReported(admin, { type, id }, io) {
  if (type === "user") {
    await setBlocked(id, true, admin._id, io);
  } else {
    const Model = type === "status" ? Status : Message;
    const deleted = await Model.findByIdAndDelete(id);
    if (!deleted) throw notFound(`${type} not found`);

    if (type === "status") await deleteMedia(deleted.mediaKey);
    if (type === "message") {
      await refreshLatestMessage(deleted.chat, deleted._id);
    }
  }

  await Report.updateMany(
    { targetType: type, targetId: id, status: "open" },
    { status: "resolved", resolvedAt: new Date(), resolvedBy: admin._id }
  );
}
