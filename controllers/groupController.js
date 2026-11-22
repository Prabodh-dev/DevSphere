import * as groups from "../services/groupService.js";
import { chatView } from "../utils/serializers.js";

export const createGroupChat = async (req, res) => {
  const group = await groups.createGroup(
    req.user,
    req.valid.body,
    req.app.get("io")
  );
  res.status(201).json(await chatView(group));
};

export const addToGroup = async (req, res) => {
  await groups.addMember(req.user, req.valid.body, req.app.get("io"));
  res.status(200).json({ message: "User added" });
};

export const removeFromGroup = async (req, res) => {
  await groups.removeMember(req.user, req.valid.body, req.app.get("io"));
  res.status(200).json({ message: "User removed" });
};

export const renameGroup = async (req, res) => {
  await groups.renameGroup(req.user, req.valid.body, req.app.get("io"));
  res.status(200).json({ message: "Group renamed" });
};

export const leaveGroup = async (req, res) => {
  await groups.leaveGroup(req.user, req.valid.body, req.app.get("io"));
  res.status(200).json({ message: "You left the group" });
};

export const promoteMember = async (req, res) => {
  await groups.promoteMember(req.user, req.valid.body, req.app.get("io"));
  res.status(200).json({ message: "User is now an admin" });
};

export const demoteMember = async (req, res) => {
  await groups.demoteMember(req.user, req.valid.body, req.app.get("io"));
  res.status(200).json({ message: "User is no longer an admin" });
};

export const deleteGroup = async (req, res) => {
  await groups.deleteGroup(
    req.user,
    { chatId: req.valid.params.chatId },
    req.app.get("io")
  );
  res.status(200).json({ message: "Group deleted" });
};
