// utils/s3.js
import { S3Client } from "@aws-sdk/client-s3";

const DEFAULT_REGION = "us-east-1";

const clean = (value) => (typeof value === "string" ? value.trim() : "");

let client;

// Uploads need a bucket; keys and region are optional (the SDK falls back to
// its default credential sources, and the region to a default).
export const isUploadConfigured = () =>
  Boolean(clean(process.env.AVATAR_BUCKET));

// Created on first use so that missing or blank upload settings never stop the
// server from starting.
export const getS3Client = () => {
  if (!client) {
    const accessKeyId = clean(process.env.AWS_ACCESS_KEY);
    const secretAccessKey = clean(process.env.AWS_SECRET_KEY);

    client = new S3Client({
      region: clean(process.env.AWS_REGION) || DEFAULT_REGION,
      ...(accessKeyId &&
        secretAccessKey && { credentials: { accessKeyId, secretAccessKey } }),
    });
  }
  return client;
};

// For tests that change the environment between uses.
export const resetS3Client = () => {
  client = undefined;
};
