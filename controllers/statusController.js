import Status from "../models/Status.js";
import { uploadToS3 } from "../utils/s3Utils.js";

/**
 * POST /api/status
 * Create a new status (text, image, or video)
 */
export const postStatus = async (req, res) => {
  try {
    const { type, content } = req.body;
    const userId = req.user._id;

    if (!type) {
      return res.status(400).json({ message: "Status type is required" });
    }

    let finalContent = content;

    // Handle image/video upload
    if (type === "image" || type === "video") {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "File is required for image/video status" });
      }

      finalContent = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

    // If text status, ensure content is provided
    if (type === "text" && !content) {
      return res.status(400).json({ message: "Text content is required" });
    }

    // Create status entry
    const status = await Status.create({
      user: userId,
      type,
      content: finalContent,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hrs
    });

    res.status(201).json({ message: "Status created", status });
  } catch (err) {
    console.error("POST STATUS ERROR:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * GET /api/status/feed
 * Fetch all active statuses from followed users
 */
export const getStatusFeed = async (req, res) => {
  try {
    const user = req.user;

    // Assuming user.following exists
    const followedIds = user.following || [];

    const statuses = await Status.find({
      user: { $in: [...followedIds, user._id] },
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .populate("user", "username avatar");

    res.status(200).json({ count: statuses.length, statuses });
  } catch (err) {
    console.error("GET FEED ERROR:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
