import { z } from "./openapi.js";
import { objectId } from "./common.js";
import { sendMessageBody } from "./index.js";

export const chatIdPayload = objectId;
// Same shape and limits as POST /chat/message.
export const messagePayload = sendMessageBody;
export const joinLiveCodePayload = z.object({ chatId: objectId });
export const codeChangePayload = z.object({
  chatId: objectId,
  code: z.string().max(100000),
  language: z.string().max(50).optional(),
  fileName: z.string().max(100).optional(),
});
