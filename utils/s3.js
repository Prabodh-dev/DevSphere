// utils/s3.js
import { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/index.js";

const DEFAULT_REGION = "us-east-1";

let client;

// Uploads need a bucket; keys and region are optional (the SDK falls back to
// its default credential sources, and the region to a default).
export const isUploadConfigured = () => Boolean(config.aws.bucket);

// Created on first use so that missing or blank upload settings never stop the
// server from starting.
export const getS3Client = () => {
  if (!client) {
    const { accessKey: accessKeyId, secretKey: secretAccessKey } = config.aws;

    client = new S3Client({
      region: config.aws.region || DEFAULT_REGION,
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
