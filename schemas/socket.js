import { z } from "./openapi.js";
import { objectId } from "./common.js";

const MAX_MESSAGE_BYTES = 16 * 1024;

// The message body is relayed as sent, so only its shape and size are checked.
const message = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .refine(
    (value) => JSON.stringify(value).length <= MAX_MESSAGE_BYTES,
    "message is too large"
  );

export const chatIdPayload = objectId;
export const messagePayload = z.object({ chatId: objectId, message });
export const joinLiveCodePayload = z.object({ chatId: objectId });
export const codeChangePayload = z.object({
  chatId: objectId,
  code: z.string().max(100000),
  language: z.string().max(50).optional(),
  fileName: z.string().max(100).optional(),
});
