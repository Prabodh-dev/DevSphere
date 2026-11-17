import { listNotifications } from "../services/notificationService.js";
import { notificationView } from "../utils/serializers.js";

export const getNotifications = async (req, res) => {
  const { docs, nextCursor } = await listNotifications(
    req.user._id,
    req.valid.query
  );
  res
    .status(200)
    .json({ items: await Promise.all(docs.map(notificationView)), nextCursor });
};
