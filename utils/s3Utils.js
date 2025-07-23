import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "./s3.js";
import { getSignedUrl as getPresignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

// Upload buffer to S3 and return URL
export const uploadToS3 = async (buffer, originalName, contentType) => {
  const key = `avatars/${uuidv4()}-${originalName}`;

  console.log("Uploading to Bucket:", process.env.AVATAR_BUCKET); // Debug log

  const params = {
    Bucket: process.env.AVATAR_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };

  await s3Client.send(new PutObjectCommand(params));

  return `https://${process.env.AVATAR_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

// Optional: Generate a signed download link (not needed for public avatars)
export const getSignedUrl = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AVATAR_BUCKET,
    Key: key,
  });

  const url = await getPresignedUrl(s3Client, command, { expiresIn: 3600 });
  return url;
};
