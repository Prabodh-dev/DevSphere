// utils/s3Utils.js
import { PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "./s3.js";
import { getSignedUrl as getPresignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

// Upload buffer to S3 and return URL
export const uploadToS3 = async (buffer, key, contentType) => {
  const params = {
    Bucket: process.env.AVATAR_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };

  await s3Client.send(new PutObjectCommand(params));

  return `https://${process.env.AVATAR_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

// (Optional) Signed download link (not used for public avatars)
export const getSignedUrl = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AVATAR_BUCKET,
    Key: key,
  });

  const url = await getPresignedUrl(s3Client, command, { expiresIn: 3600 });
  return url;
};
