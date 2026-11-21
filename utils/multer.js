// utils/multer.js
import multer from "multer";
import { HttpError } from "./httpError.js";
import { config } from "../config/index.js";
import { CHAT_FILE_TYPES, IMAGE_TYPES, VIDEO_TYPES } from "./fileType.js";

const MB = 1024 * 1024;

const build = (allowedTypes, maxFileSize) =>
  multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSize,
      files: 1,
      fields: 20,
      fieldSize: 10 * 1024,
    },
    fileFilter: (req, file, cb) => {
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new HttpError(415, "Unsupported file type"));
      }
      cb(null, true);
    },
  });

// Avatars: images only, up to 2 MB.
export const uploadAvatar = build(IMAGE_TYPES, 2 * MB);

// Status media: images or short videos, up to 20 MB.
export const uploadStatusMedia = build(
  [...IMAGE_TYPES, ...VIDEO_TYPES],
  20 * MB
);

// Chat media: an image or a PDF or ZIP file in the `file` field. The upload
// limit follows the settings, so it is worked out for each request; the size
// limit of each kind is enforced when the message is sent.
export const uploadChatMedia = (req, res, next) =>
  build(
    [...IMAGE_TYPES, ...CHAT_FILE_TYPES],
    Math.max(config.chatMedia.imageMaxBytes, config.chatMedia.fileMaxBytes)
  ).single("file")(req, res, next);
