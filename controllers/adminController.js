import User from "../models/User.js";
import Report from "../models/Report.js";

export const getAllUsers = async (req, res) => {
  const users = await User.find().select("-password");
  res.status(200).json(users);
};

export const blockUser = async (req, res) => {
  const userId = req.params.id;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  user.isBlocked = true;
  await user.save();
  res.status(200).json({ message: "User blocked" });
};

export const unblockUser = async (req, res) => {
  const userId = req.params.id;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  user.isBlocked = false;
  await user.save();
  res.status(200).json({ message: "User unblocked" });
};

export const getReports = async (req, res) => {
  const reports = await Report.find().populate("reportedBy", "username");
  res.status(200).json(reports);
};

export const deleteReportedItem = async (req, res) => {
  const { type, id } = req.params;

  try {
    if (type === "status") {
      await import("../models/Status.js").then(({ default: Status }) =>
        Status.findByIdAndDelete(id)
      );
    } else if (type === "message") {
      await import("../models/Message.js").then(({ default: Message }) =>
        Message.findByIdAndDelete(id)
      );
    }
    res.status(200).json({ message: `${type} deleted` });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: err.message });
  }
};
