import { z } from "./openapi.js";

// Shapes of what the API sends back. They are used to build the OpenAPI
// document and are checked against real responses in the tests.

const id = (example) =>
  z.string().openapi({ example, description: "Object id" });
const date = (example) => z.iso.datetime().openapi({ example });

const ID = "665f1c2a9b1e8a0012a4c001";
const ID2 = "665f1c2a9b1e8a0012a4c002";
const WHEN = "2025-01-15T10:30:00.000Z";

// ---- errors and pagination ----
export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string().openapi({ example: "Request validation failed" }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse", {
    example: {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [
          {
            field: "email",
            location: "body",
            message: "must be a valid email address",
          },
        ],
      },
    },
  });

export const MessageResponse = z
  .object({ message: z.string() })
  .openapi("MessageResponse", { example: { message: "Logged out" } });

export const page = (name, item) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable().openapi({
        description: "Pass as `cursor` for the next page; null at the end",
      }),
    })
    .openapi(name);

// ---- users ----
export const PublicUser = z
  .object({
    _id: id(ID),
    username: z.string().openapi({ example: "ada" }),
    avatar: z.string().openapi({
      example: "",
      description: "Short-lived signed URL, or empty",
    }),
  })
  .openapi("PublicUser");

export const TaggedUser = PublicUser.extend({
  tags: z.array(z.string()).openapi({ example: ["node", "mongodb"] }),
}).openapi("TaggedUser");

export const AdminUser = z
  .object({
    _id: id(ID),
    username: z.string(),
    email: z.string(),
    avatarKey: z.string().optional(),
    role: z.enum(["user", "admin"]),
    isBlocked: z.boolean(),
    tags: z.array(z.string()),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("AdminUser");

// ---- auth ----
export const AuthResponse = z
  .object({
    _id: id(ID),
    username: z.string(),
    email: z.string(),
    token: z.string().openapi({ description: "Access token (JWT)" }),
    expiresIn: z
      .number()
      .int()
      .openapi({ example: 900, description: "Seconds" }),
  })
  .openapi("AuthResponse", {
    example: {
      _id: ID,
      username: "ada",
      email: "ada@example.com",
      token: "eyJhbGciOi...",
      expiresIn: 900,
    },
  });

export const TokenResponse = z
  .object({ token: z.string(), expiresIn: z.number().int() })
  .openapi("TokenResponse", {
    example: { token: "eyJhbGciOi...", expiresIn: 900 },
  });

export const SessionInfo = z
  .object({
    id: id(ID),
    createdAt: date(WHEN),
    lastUsedAt: date(WHEN),
    userAgent: z.string(),
    current: z.boolean(),
  })
  .openapi("SessionInfo");

// ---- profile ----
export const Profile = z
  .object({
    _id: id(ID),
    user: z.object({ _id: id(ID2), username: z.string() }),
    avatar: z.string(),
    tags: z.array(z.string()),
    bio: z.string().optional(),
    github: z.string().optional(),
    linkedin: z.string().optional(),
    website: z.string().optional(),
    followersCount: z.number().int(),
    followingCount: z.number().int(),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .openapi("Profile");

export const TagsResponse = z
  .object({ message: z.string(), tags: z.array(z.string()) })
  .openapi("TagsResponse");

// ---- chat ----
const LatestMessage = z
  .object({
    sender: z.object({ _id: id(ID), username: z.string() }).nullable(),
    preview: z.string().openapi({ example: "See you at 5" }),
    createdAt: date(WHEN),
  })
  .nullable();

export const Chat = z
  .object({
    _id: id(ID),
    isGroupChat: z.boolean(),
    chatName: z.string().optional(),
    members: z.array(id(ID2)),
    admins: z.array(id(ID2)),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("Chat");

export const ChatListItem = z
  .object({
    _id: id(ID),
    isGroupChat: z.boolean(),
    chatName: z.string().optional(),
    members: z.array(PublicUser),
    admins: z.array(id(ID2)),
    latestMessage: LatestMessage,
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("ChatListItem");

export const Message = z
  .object({
    _id: id(ID),
    chat: z.union([
      id(ID2),
      z.object({
        _id: id(ID2),
        isGroupChat: z.boolean(),
        chatName: z.string().optional(),
      }),
    ]),
    sender: z.object({ _id: id(ID), username: z.string() }),
    type: z.enum(["text", "media", "code"]),
    text: z.string().optional(),
    code: z
      .object({
        language: z.string().optional(),
        content: z.string().optional(),
      })
      .optional(),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("Message");

// ---- status ----
export const StatusItem = z
  .object({
    _id: id(ID),
    user: z.union([PublicUser, id(ID2)]),
    type: z.enum(["text", "image", "video"]),
    content: z.string().openapi({
      description: "The text, or a short-lived signed URL for media",
    }),
    visibleUntil: date(WHEN),
    expiresAt: date(WHEN),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("Status");

export const StatusCreated = z
  .object({ message: z.string(), status: StatusItem })
  .openapi("StatusCreated");

// ---- other ----
export const Highlighted = z
  .object({
    highlighted: z
      .string()
      .openapi({ description: "HTML with highlight.js classes" }),
  })
  .openapi("Highlighted", {
    example: { highlighted: '<span class="hljs-keyword">const</span> a = 1;' },
  });

export const LiveCodeDoc = z
  .object({
    _id: id(ID),
    chatId: id(ID2),
    code: z.string(),
    language: z.string(),
    fileName: z.string(),
    updatedBy: id(ID).optional(),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .nullable()
  .openapi("LiveCode");

export const NotificationItem = z
  .object({
    _id: id(ID),
    user: id(ID2),
    type: z.enum(["message", "follow", "group", "status"]),
    content: z.string().optional(),
    fromUser: PublicUser.nullable().optional(),
    chatId: id(ID2).optional(),
    seen: z.boolean(),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("Notification");

export const ReportItem = z
  .object({
    _id: id(ID),
    reportedBy: z.union([
      id(ID2),
      z.object({ _id: id(ID2), username: z.string() }),
    ]),
    targetType: z.enum(["message", "status", "user"]),
    targetId: id(ID),
    reason: z.string(),
    status: z.enum(["open", "resolved"]),
    createdAt: date(WHEN),
    updatedAt: date(WHEN),
  })
  .loose()
  .openapi("Report");
