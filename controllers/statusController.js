import * as statuses from "../services/statusService.js";
import { replyView, statusView } from "../utils/serializers.js";

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
  const { docs, nextCursor, liked } = await statuses.getFeed(
    req.user._id,
    req.valid.query
  );
  const items = await Promise.all(
    docs.map((status) => statusView(status, liked.has(status.id)))
  );
  res.status(200).json({ items, nextCursor });
};

export const getStatus = async (req, res) => {
  const { status, likedByMe } = await statuses.getStatus(
    req.user._id,
    req.valid.params.id
  );
  res.status(200).json(await statusView(status, likedByMe));
};

export const deleteStatus = async (req, res) => {
  await statuses.deleteOwnStatus(req.user._id, req.valid.params.id);
  res.status(200).json({ message: "Status deleted" });
};

export const likeStatus = async (req, res) => {
  const status = await statuses.likeStatus(
    req.user,
    req.valid.params.id,
    req.app.get("io")
  );
  res.status(200).json({ liked: true, likeCount: status.likeCount });
};

export const unlikeStatus = async (req, res) => {
  const status = await statuses.unlikeStatus(req.user, req.valid.params.id);
  res.status(200).json({ liked: false, likeCount: status.likeCount });
};

export const replyToStatus = async (req, res) => {
  const reply = await statuses.replyToStatus(
    req.user,
    req.valid.params.id,
    req.valid.body,
    req.app.get("io")
  );
  res.status(201).json(await replyView(reply));
};

export const getReplies = async (req, res) => {
  const { docs, nextCursor } = await statuses.listReplies(
    req.user._id,
    req.valid.params.id,
    req.valid.query
  );
  res
    .status(200)
    .json({ items: await Promise.all(docs.map(replyView)), nextCursor });
};

export const viewStatus = async (req, res) => {
  const status = await statuses.recordView(req.user._id, req.valid.params.id);
  res.status(200).json({ viewCount: status.viewCount });
};
