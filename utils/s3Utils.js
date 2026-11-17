import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getS3Client, isUploadConfigured } from "./s3.js";
import { EXTENSIONS, detectMime } from "./fileType.js";
import { badRequest, uploadsNotConfigured } from "./httpError.js";
import { config } from "../config/index.js";

const notConfigured = uploadsNotConfigured;

// Uploads a file to the private bucket and returns its object key. The key is
// generated here; nothing supplied by the client ends up in it.
export const uploadMedia = async ({ buffer, mimetype, prefix }) => {
  if (!isUploadConfigured()) throw notConfigured();

  const detected = detectMime(buffer);
  if (!detected || detected !== mimetype) {
    throw badRequest("File content does not match its type");
  }

  const key = `${prefix}/${randomUUID()}.${EXTENSIONS[detected]}`;

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: config.aws.bucket,
        Key: key,
        Body: buffer,
        ContentType: detected,
      })
    );
  } catch (err) {
    // No usable credentials is a configuration problem, not a server fault.
    if (err?.name === "CredentialsProviderError") throw notConfigured();
    throw err;
  }

  return key;
};

// Short-lived download link for a stored object.
export const getSignedMediaUrl = async (key) => {
  if (!key || !isUploadConfigured()) return "";
  const command = new GetObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
  });
  return getSignedUrl(getS3Client(), command, {
    expiresIn: config.mediaUrlTtlSeconds,
  });
};

// Best effort: a failed delete is logged and never fails the request.
export const deleteMedia = async (key) => {
  if (!key || !isUploadConfigured()) return false;
  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: config.aws.bucket,
        Key: key,
      })
    );
    return true;
  } catch (err) {
    console.warn("Could not delete stored file:", err.message);
    return false;
  }
};
