// Detects a file's real type from its first bytes, so the type declared by the
// client is never trusted on its own.
const startsWith = (buffer, bytes, offset = 0) =>
  bytes.every((byte, i) => buffer[offset + i] === byte);

const ascii = (buffer, start, end) => buffer.toString("latin1", start, end);

export function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (["GIF87a", "GIF89a"].includes(ascii(buffer, 0, 6))) return "image/gif";
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(buffer, 4, 8) === "ftyp") {
    return ascii(buffer, 8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
