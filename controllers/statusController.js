import * as statuses from "../services/statusService.js";
import { statusView } from "../utils/serializers.js";

export const postStatus = async (req, res) => {
  const status = await statuses.createStatus(
    req.user._id,
    req.valid.body,
    req.file
  );
  res
    .status(201)
    .json({ message: "Status created", status: await statusView(status) });
};

export const getStatusFeed = async (req, res) => {
  const { docs, nextCursor } = await statuses.getFeed(
    req.user._id,
    req.valid.query
  );
  res
    .status(200)
    .json({ items: await Promise.all(docs.map(statusView)), nextCursor });
};
