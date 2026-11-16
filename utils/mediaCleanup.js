import mongoose from "mongoose";
import Status from "../models/Status.js";
import { deleteMedia } from "./s3Utils.js";

// Removes stored files of statuses whose viewing window has ended. The status
// record itself is removed later by the TTL index.
export async function cleanupExpiredStatusMedia({ limit = 100 } = {}) {
  const expired = await Status.find({
    visibleUntil: mongoose.trusted({ $lte: new Date() }),
    mediaKey: mongoose.trusted({ $exists: true, $ne: null }),
  }).limit(limit);

  let removed = 0;
  for (const status of expired) {
    if (await deleteMedia(status.mediaKey)) {
      await Status.updateOne({ _id: status._id }, { $unset: { mediaKey: 1 } });
      removed += 1;
    }
  }
  return removed;
}
