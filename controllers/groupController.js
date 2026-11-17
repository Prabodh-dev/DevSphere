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
  await groups.renameGroup(req.user, req.valid.body);
  res.status(200).json({ message: "Group renamed" });
};
