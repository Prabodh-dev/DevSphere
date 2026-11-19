import { getPresence } from "../services/presenceService.js";

export const getPresenceOf = async (req, res) => {
  const ids = req.valid.query.ids.split(",");
  res.status(200).json({ items: await getPresence(req.user._id, ids) });
};
