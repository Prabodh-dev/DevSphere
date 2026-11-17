import { z } from "zod";
import {
  email,
  httpUrl,
  objectId,
  optional,
  tagList,
  tags,
  text,
} from "./common.js";

// ---- auth ----
const passwordRule = z
  .string()
  .min(10, "must be at least 10 characters")
  .max(72, "must be at most 72 characters")
  .regex(/[A-Za-z]/, "must contain a letter")
  .regex(/\d/, "must contain a digit");

export const registerBody = z.object({
  username: text(30, 3).regex(
    /^[A-Za-z0-9_.-]+$/,
    "may only contain letters, numbers, dots, dashes and underscores"
  ),
  email,
  password: passwordRule,
});

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordRule,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ["newPassword"],
    message: "must be different from the current password",
  });

export const sessionIdParams = z.object({ id: objectId });

export const loginBody = z.object({
  email: text(254),
  password: z.string().min(1).max(72),
});

// ---- profile ----
export const profileBody = z.object({
  bio: optional(text(300)),
  github: optional(httpUrl),
  linkedin: optional(httpUrl),
  website: optional(httpUrl),
  tags: tags.optional(),
});
export const profileParams = z.object({ userId: objectId });

// ---- users ----
export const userIdParams = z.object({ id: objectId });
// Cursor pagination: limit (default 30, at most 100) and an opaque cursor.
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(500).optional(),
});
export const tagsBody = z.object({ tags: tagList });
export const tagQuery = pageQuery.extend({ tag: text(30) });

// ---- chat ----
export const accessChatBody = z.object({ userId: objectId });
export const chatIdParams = z.object({ chatId: objectId });

export const sendMessageBody = z
  .object({
    chatId: objectId,
    type: z.enum(["text", "media", "code"]).default("text"),
    text: z.string().trim().min(1).max(5000).optional(),
    code: z
      .object({
        language: text(50).optional(),
        content: z.string().min(1).max(100000),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.type === "code") {
      if (!body.code) {
        ctx.addIssue({
          code: "custom",
          path: ["code"],
          message: "is required",
        });
      }
    } else if (!body.text) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "is required" });
    }
  });

// ---- groups ----
export const createGroupBody = z.object({
  chatName: text(100),
  members: z.array(objectId).max(100, "at most 100 members are allowed"),
});
export const groupMemberBody = z.object({ chatId: objectId, userId: objectId });
export const renameGroupBody = z.object({
  chatId: objectId,
  newName: text(100),
});

// ---- status ----
export const statusBody = z
  .object({
    type: z.enum(["text", "image", "video"]),
    content: text(1000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.type === "text" && !body.content) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "is required",
      });
    }
  });

// ---- reports and admin ----
export const reportBody = z.object({
  targetType: z.enum(["message", "status", "user"]),
  targetId: objectId,
  reason: text(1000),
});
export const removeParams = z.object({
  type: z.enum(["status", "message", "user"]),
  id: objectId,
});

// ---- snippets ----
export const highlightBody = z.object({
  code: z.string().min(1).max(20000),
  language: text(50).optional(),
});

export const reportsQuery = pageQuery.extend({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});
