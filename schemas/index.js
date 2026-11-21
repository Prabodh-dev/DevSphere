import { z } from "./openapi.js";
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

// Media messages are uploaded to POST /chat/media instead.
export const sendMessageBody = z
  .object({
    chatId: objectId,
    type: z.enum(["text", "code"]).default("text"),
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

export const mediaMessageBody = z.object({ chatId: objectId });
export const markReadBody = z.object({ messageId: objectId });

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
  targetType: z.enum(["message", "status", "user", "snippet"]),
  targetId: objectId,
  reason: text(1000),
});
export const removeParams = z.object({
  type: z.enum(["status", "message", "user", "snippet"]),
  id: objectId,
});

// ---- snippets ----
const snippetTags = z
  .array(text(30).toLowerCase())
  .max(10, "at most 10 tags are allowed");
const snippetFields = {
  title: text(100),
  description: z.string().trim().max(500),
  code: z.string().min(1).max(50000),
  language: text(50),
  tags: snippetTags,
  visibility: z.enum(["public", "private"]),
};
export const createSnippetBody = z.object({
  title: snippetFields.title,
  description: snippetFields.description.optional(),
  code: snippetFields.code,
  language: snippetFields.language.optional(),
  tags: snippetFields.tags.optional(),
  visibility: snippetFields.visibility.default("private"),
});
export const updateSnippetBody = z
  .object({
    title: snippetFields.title.optional(),
    description: snippetFields.description.optional(),
    code: snippetFields.code.optional(),
    language: snippetFields.language.optional(),
    tags: snippetFields.tags.optional(),
    visibility: snippetFields.visibility.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "send at least one field to change",
  });
export const snippetIdParams = z.object({ id: objectId });
export const snippetUserParams = z.object({ userId: objectId });
// Filters for lists of snippets.
export const snippetListQuery = pageQuery.extend({
  language: text(50).optional(),
  tag: text(30).toLowerCase().optional(),
});
export const mySnippetsQuery = snippetListQuery.extend({
  visibility: z.enum(["public", "private"]).optional(),
});

export const highlightBody = z.object({
  code: z.string().min(1).max(20000),
  language: text(50).optional(),
});

export const reportsQuery = pageQuery.extend({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});

export const notificationIdParams = z.object({ id: objectId });

// ---- presence ----
const MAX_PRESENCE_IDS = 100;
export const presenceQuery = z.object({
  ids: z
    .string()
    .min(1)
    .max(MAX_PRESENCE_IDS * 25)
    .refine((value) => {
      const ids = value.split(",");
      return (
        ids.length <= MAX_PRESENCE_IDS &&
        ids.every((id) => /^[0-9a-fA-F]{24}$/.test(id))
      );
    }, `must be at most ${MAX_PRESENCE_IDS} comma separated user ids`),
});
