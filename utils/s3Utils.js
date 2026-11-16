import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import s3Client from "./s3.js";
import { EXTENSIONS, detectMime } from "./fileType.js";
import { badRequest } from "./httpError.js";

const DEFAULT_URL_TTL_SECONDS = 300;

const urlTtl = () => {
  const configured = Number(process.env.MEDIA_URL_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_URL_TTL_SECONDS;
  }
  return Math.min(Math.floor(configured), 3600);
};

// Uploads a file to the private bucket and returns its object key. The key is
// generated here; nothing supplied by the client ends up in it.
export const uploadMedia = async ({ buffer, mimetype, prefix }) => {
  const detected = detectMime(buffer);
  if (!detected || detected !== mimetype) {
    throw badRequest("File content does not match its type");
  }

  const key = `${prefix}/${randomUUID()}.${EXTENSIONS[detected]}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AVATAR_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: detected,
    })
  );

  return key;
};

// Short-lived download link for a stored object.
export const getSignedMediaUrl = async (key) => {
  if (!key) return "";
  const command = new GetObjectCommand({
    Bucket: process.env.AVATAR_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: urlTtl() });
};

// Best effort: a failed delete is logged and never fails the request.
export const deleteMedia = async (key) => {
  if (!key) return false;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AVATAR_BUCKET,
        Key: key,
      })
    );
    return true;
  } catch (err) {
    console.warn("Could not delete stored file:", err.message);
    return false;
  }
};
