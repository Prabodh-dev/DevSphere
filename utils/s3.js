// utils/s3.js
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

// Explicit keys are optional; without them the SDK falls back to its default
// credential sources (for example an instance or task role).
const hasKeys = process.env.AWS_ACCESS_KEY && process.env.AWS_SECRET_KEY;

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  ...(hasKeys && {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_KEY,
    },
  }),
});

export default s3Client;
