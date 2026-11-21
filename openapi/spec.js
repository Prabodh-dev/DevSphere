import { readFileSync } from "fs";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "../schemas/openapi.js";
import * as S from "../schemas/index.js";
import * as R from "../schemas/responses.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Access token from login, register or refresh.",
});
registry.registerComponent("securitySchemes", "refreshCookie", {
  type: "apiKey",
  in: "cookie",
  name: "refresh_token",
  description:
    "httpOnly refresh cookie set by login. Requests must come from an allowed Origin.",
});

const ERROR_TEXT = {
  400: "Invalid request",
  401: "Missing, invalid or expired credentials",
  403: "Not allowed",
  404: "Not found",
  409: "Conflict with existing data",
  413: "Too large",
  415: "Unsupported file type",
  429: "Too many requests",
  503: "Uploads are not configured",
};

const json = (schema, example) => ({
  content: { "application/json": { schema, ...(example && { example }) } },
});

const errorResponses = (statuses) =>
  Object.fromEntries(
    statuses.map((status) => [
      status,
      { description: ERROR_TEXT[status], ...json(R.ErrorResponse) },
    ])
  );

const SET_COOKIE = {
  "Set-Cookie": {
    description: "The refresh token cookie (httpOnly, SameSite=Strict)",
    schema: z.string(),
  },
};

const file = (description) =>
  z.string().openapi({ type: "string", format: "binary", description });

// One entry per Express route.
//   auth: "bearer" | "cookie" | undefined (public)
function route({
  method,
  path,
  tags,
  summary,
  description,
  auth,
  params,
  query,
  body,
  multipart,
  bodyExample,
  ok = 200,
  response,
  example,
  headers,
  errors = [],
}) {
  const request = {};
  if (params) request.params = params;
  if (query) request.query = query;
  if (body) request.body = { required: true, ...json(body, bodyExample) };
  if (multipart) {
    request.body = {
      required: true,
      content: {
        "multipart/form-data": { schema: multipart },
        ...(body && { "application/json": { schema: body } }),
      },
    };
  }

  const statuses = new Set(errors);
  if (params || query || body || multipart) statuses.add(400);
  if (auth === "bearer") statuses.add(401);
  statuses.add(429);

  registry.registerPath({
    method,
    path,
    tags,
    summary,
    ...(description && { description }),
    security:
      auth === "bearer"
        ? [{ bearerAuth: [] }]
        : auth === "cookie"
          ? [{ refreshCookie: [] }]
          : [],
    request,
    responses: {
      [ok]: {
        description: "Success",
        ...(headers && { headers }),
        ...json(response, example),
      },
      ...errorResponses([...statuses].sort()),
    },
  });
}

const paged = (name, item) => R.page(name, item);

// ---- auth ----
route({
  method: "post",
  path: "/auth/register",
  tags: ["Auth"],
  summary: "Create an account and sign in",
  body: S.registerBody,
  bodyExample: {
    username: "ada",
    email: "ada@example.com",
    password: "a-long-passw0rd",
  },
  ok: 201,
  response: R.AuthResponse,
  headers: SET_COOKIE,
  errors: [409],
});
route({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  summary: "Sign in",
  body: S.loginBody,
  bodyExample: { email: "ada@example.com", password: "a-long-passw0rd" },
  response: R.AuthResponse,
  headers: SET_COOKIE,
  errors: [401, 403],
});
route({
  method: "post",
  path: "/auth/refresh",
  tags: ["Auth"],
  summary: "Exchange the refresh cookie for a new access token",
  description:
    "Rotates the refresh token. Needs an Origin header from CORS_ORIGINS.",
  auth: "cookie",
  response: R.TokenResponse,
  headers: SET_COOKIE,
  errors: [401, 403],
});
route({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  summary: "End the current login",
  auth: "cookie",
  response: R.MessageResponse,
  errors: [403],
});
route({
  method: "post",
  path: "/auth/logout-all",
  tags: ["Auth"],
  summary: "End every login of the user",
  auth: "bearer",
  response: R.MessageResponse,
});
route({
  method: "get",
  path: "/auth/sessions",
  tags: ["Auth"],
  summary: "List active logins",
  auth: "bearer",
  response: z.array(R.SessionInfo),
});
route({
  method: "delete",
  path: "/auth/sessions/{id}",
  tags: ["Auth"],
  summary: "End one login",
  auth: "bearer",
  params: S.sessionIdParams,
  response: R.MessageResponse,
  errors: [404],
});
route({
  method: "post",
  path: "/auth/change-password",
  tags: ["Auth"],
  summary: "Change the password and end the other logins",
  auth: "bearer",
  body: S.changePasswordBody,
  response: R.MessageResponse,
  errors: [403],
});

// ---- profile ----
route({
  method: "post",
  path: "/profile",
  tags: ["Profile"],
  summary: "Create or update the profile",
  description:
    "Send JSON, or multipart/form-data with an `avatar` image (up to 2 MB). Only the fields sent are changed.",
  auth: "bearer",
  body: S.profileBody,
  multipart: S.profileBody.extend({
    avatar: file("Image, up to 2 MB").optional(),
  }),
  response: R.Profile,
  errors: [413, 415, 503],
});
route({
  method: "get",
  path: "/profile/me",
  tags: ["Profile"],
  summary: "The signed-in user's profile",
  auth: "bearer",
  response: R.Profile,
  errors: [404],
});
route({
  method: "get",
  path: "/profile/{userId}",
  tags: ["Profile"],
  summary: "A user's profile",
  params: S.profileParams,
  response: R.Profile,
  errors: [404],
});

// ---- users ----
route({
  method: "post",
  path: "/users/{id}/follow",
  tags: ["Users"],
  summary: "Follow a user",
  auth: "bearer",
  params: S.userIdParams,
  response: R.MessageResponse,
  errors: [404],
});
route({
  method: "post",
  path: "/users/{id}/unfollow",
  tags: ["Users"],
  summary: "Unfollow a user",
  auth: "bearer",
  params: S.userIdParams,
  response: R.MessageResponse,
  errors: [404],
});
route({
  method: "patch",
  path: "/users/me/tags",
  tags: ["Users"],
  summary: "Replace your tags",
  auth: "bearer",
  body: S.tagsBody,
  bodyExample: { tags: ["node", "mongodb"] },
  response: R.TagsResponse,
});
route({
  method: "get",
  path: "/users/{id}/followers",
  tags: ["Users"],
  summary: "Followers of a user, newest first",
  auth: "bearer",
  params: S.userIdParams,
  query: S.pageQuery,
  response: paged("FollowersPage", R.PublicUser),
  errors: [404],
});
route({
  method: "get",
  path: "/users/{id}/following",
  tags: ["Users"],
  summary: "Users someone follows, newest first",
  auth: "bearer",
  params: S.userIdParams,
  query: S.pageQuery,
  response: paged("FollowingPage", R.PublicUser),
  errors: [404],
});
route({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "Find users by tag",
  auth: "bearer",
  query: S.tagQuery,
  response: paged("UserSearchPage", R.TaggedUser),
});

// ---- chat ----
route({
  method: "post",
  path: "/chat/access",
  tags: ["Chat"],
  summary: "Open (or create) a one-to-one chat",
  auth: "bearer",
  body: S.accessChatBody,
  response: R.Chat,
  errors: [404],
});
route({
  method: "get",
  path: "/chat",
  tags: ["Chat"],
  summary: "Your chats, most recent activity first",
  auth: "bearer",
  query: S.pageQuery,
  response: paged("ChatPage", R.ChatListItem),
});
route({
  method: "post",
  path: "/chat/message",
  tags: ["Chat"],
  summary: "Send a message",
  auth: "bearer",
  body: S.sendMessageBody,
  bodyExample: { chatId: "665f1c2a9b1e8a0012a4c001", text: "Hello" },
  ok: 201,
  response: R.Message,
  errors: [403, 404],
});
route({
  method: "post",
  path: "/chat/media",
  tags: ["Chat"],
  summary: "Send an image or a file",
  description:
    "multipart/form-data with `chatId` and a `file`: an image (JPEG, PNG, WebP, GIF, up to `CHAT_IMAGE_MAX_MB`) or a PDF or ZIP file (up to `CHAT_FILE_MAX_MB`). The type is checked from the file's bytes. The message is delivered like any other. Responses carry a signed link, never the storage key. Answers 503 `UPLOADS_NOT_CONFIGURED` when storage is not set up.",
  auth: "bearer",
  multipart: z.object({
    chatId: z.string(),
    file: file("Image, PDF or ZIP"),
  }),
  ok: 201,
  response: R.Message,
  errors: [403, 404, 413, 415, 503],
});
route({
  method: "put",
  path: "/chat/{chatId}/read",
  tags: ["Chat"],
  summary: "Mark a chat as read up to a message",
  description:
    "Only members can do this, and the marker only moves forward: an older message changes nothing. A change is sent to the chat as a `read-receipt` socket event.",
  auth: "bearer",
  params: S.chatIdParams,
  body: S.markReadBody,
  bodyExample: { messageId: "665f1c2a9b1e8a0012a4c010" },
  response: R.ReadState,
  errors: [403, 404],
});
route({
  method: "get",
  path: "/chat/message/{chatId}",
  tags: ["Chat"],
  summary: "Messages of a chat, newest first",
  description:
    "Use the `nextCursor` of a page as `cursor` to get older messages.",
  auth: "bearer",
  params: S.chatIdParams,
  query: S.pageQuery,
  response: paged("MessagePage", R.Message),
  errors: [403, 404],
});

// ---- groups ----
route({
  method: "post",
  path: "/group/create",
  tags: ["Groups"],
  summary: "Create a group chat",
  auth: "bearer",
  body: S.createGroupBody,
  ok: 201,
  response: R.ChatListItem,
});
route({
  method: "patch",
  path: "/group/add",
  tags: ["Groups"],
  summary: "Add a member (group admins only)",
  auth: "bearer",
  body: S.groupMemberBody,
  response: R.MessageResponse,
  errors: [403, 404],
});
route({
  method: "patch",
  path: "/group/remove",
  tags: ["Groups"],
  summary: "Remove a member (group admins only)",
  auth: "bearer",
  body: S.groupMemberBody,
  response: R.MessageResponse,
  errors: [403, 404],
});
route({
  method: "patch",
  path: "/group/rename",
  tags: ["Groups"],
  summary: "Rename a group (group admins only)",
  auth: "bearer",
  body: S.renameGroupBody,
  response: R.MessageResponse,
  errors: [403, 404],
});

// ---- status ----
route({
  method: "post",
  path: "/status",
  tags: ["Status"],
  summary: "Post a status that lasts 24 hours",
  description:
    "Text statuses can be JSON. Image and video statuses are multipart/form-data with a `media` file (images or videos, up to 20 MB).",
  auth: "bearer",
  body: S.statusBody,
  multipart: z.object({
    type: z.enum(["text", "image", "video"]),
    content: z.string().optional(),
    media: file("Image or video, up to 20 MB").optional(),
  }),
  ok: 201,
  response: R.StatusCreated,
  errors: [413, 415, 503],
});
route({
  method: "get",
  path: "/status/feed",
  tags: ["Status"],
  summary: "Active statuses from you and the people you follow",
  auth: "bearer",
  query: S.pageQuery,
  response: paged("StatusPage", R.StatusItem),
});

// ---- other ----
route({
  method: "post",
  path: "/snippets/highlight",
  tags: ["Snippets"],
  summary: "Highlight code on the server",
  description: "Public, rate limited. Code is limited to 20000 characters.",
  body: S.highlightBody,
  bodyExample: { code: "const a = 1;", language: "javascript" },
  response: R.Highlighted,
});
route({
  method: "post",
  path: "/snippets",
  tags: ["Snippets"],
  summary: "Save a snippet",
  description:
    "Snippets are private unless `visibility` is `public`. Code is limited to 50000 characters, titles to 100, descriptions to 500, and a snippet has at most 10 tags (stored in lower case).",
  auth: "bearer",
  body: S.createSnippetBody,
  bodyExample: {
    title: "Debounce helper",
    code: "const debounce = (fn, ms) => { /* ... */ };",
    language: "javascript",
    tags: ["utils"],
    visibility: "public",
  },
  ok: 201,
  response: R.Snippet,
});
route({
  method: "get",
  path: "/snippets",
  tags: ["Snippets"],
  summary: "Search public snippets",
  description:
    "Public snippets of everyone, newest first, optionally filtered by `tag` and `language`.",
  auth: "bearer",
  query: S.snippetListQuery,
  response: paged("SnippetPage", R.Snippet),
});
route({
  method: "get",
  path: "/snippets/mine",
  tags: ["Snippets"],
  summary: "Your snippets, public and private",
  auth: "bearer",
  query: S.mySnippetsQuery,
  response: paged("MySnippetPage", R.Snippet),
});
route({
  method: "get",
  path: "/snippets/user/{userId}",
  tags: ["Snippets"],
  summary: "The public snippets of a user",
  auth: "bearer",
  params: S.snippetUserParams,
  query: S.snippetListQuery,
  response: paged("UserSnippetPage", R.Snippet),
  errors: [404],
});
route({
  method: "get",
  path: "/snippets/{id}",
  tags: ["Snippets"],
  summary: "Read a snippet",
  description:
    "Public snippets can be read by anyone signed in; a private snippet only by its owner (everyone else gets 404).",
  auth: "bearer",
  params: S.snippetIdParams,
  response: R.Snippet,
  errors: [404],
});
route({
  method: "patch",
  path: "/snippets/{id}",
  tags: ["Snippets"],
  summary: "Change one of your snippets",
  auth: "bearer",
  params: S.snippetIdParams,
  body: S.updateSnippetBody,
  bodyExample: { visibility: "private" },
  response: R.Snippet,
  errors: [404],
});
route({
  method: "delete",
  path: "/snippets/{id}",
  tags: ["Snippets"],
  summary: "Delete one of your snippets",
  auth: "bearer",
  params: S.snippetIdParams,
  response: R.MessageResponse,
  errors: [404],
});
route({
  method: "get",
  path: "/live-code/{chatId}",
  tags: ["Live code"],
  summary: "The shared code document of a chat (null if none)",
  auth: "bearer",
  params: S.chatIdParams,
  response: R.LiveCodeDoc,
  errors: [403, 404],
});
route({
  method: "get",
  path: "/presence",
  tags: ["Presence"],
  summary: "Who is online",
  description:
    "Online state and last seen time of up to 100 users. Only people you share a chat with or follow (and you) are returned; other ids are left out of the answer.",
  auth: "bearer",
  query: S.presenceQuery,
  response: R.PresenceList,
});
route({
  method: "get",
  path: "/notifications",
  tags: ["Notifications"],
  summary: "Your notifications, newest first",
  auth: "bearer",
  query: S.pageQuery,
  response: paged("NotificationPage", R.NotificationItem),
});
route({
  method: "post",
  path: "/report",
  tags: ["Reports"],
  summary: "Report a message, status or user",
  auth: "bearer",
  body: S.reportBody,
  ok: 201,
  response: R.ReportItem,
  errors: [404, 409],
});

// ---- admin ----
route({
  method: "get",
  path: "/admin/users",
  tags: ["Admin"],
  summary: "All users, newest first",
  auth: "bearer",
  query: S.pageQuery,
  response: paged("AdminUserPage", R.AdminUser),
  errors: [403],
});
route({
  method: "patch",
  path: "/admin/block/{id}",
  tags: ["Admin"],
  summary: "Block a user and end their sessions",
  auth: "bearer",
  params: S.userIdParams,
  response: R.MessageResponse,
  errors: [403, 404],
});
route({
  method: "patch",
  path: "/admin/unblock/{id}",
  tags: ["Admin"],
  summary: "Unblock a user",
  auth: "bearer",
  params: S.userIdParams,
  response: R.MessageResponse,
  errors: [403, 404],
});
route({
  method: "get",
  path: "/admin/reports",
  tags: ["Admin"],
  summary: "Reports (open by default)",
  auth: "bearer",
  query: S.reportsQuery,
  response: paged("ReportPage", R.ReportItem),
  errors: [403],
});
route({
  method: "delete",
  path: "/admin/remove/{type}/{id}",
  tags: ["Admin"],
  summary: "Remove reported content, or block a reported user",
  auth: "bearer",
  params: S.removeParams,
  response: R.MessageResponse,
  errors: [403, 404],
});

let cached;

export function buildOpenApiDocument() {
  if (cached) return cached;
  const generated = new OpenApiGeneratorV31(
    registry.definitions
  ).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "DevSphere API",
      version: pkg.version,
      description:
        "REST API of DevSphere. Errors always look like `{ error: { code, message, details? } }`. Lists use cursor pagination: `limit` (default 30, at most 100) and `cursor`, answered with `{ items, nextCursor }`. Real-time events are described in docs/socket-events.md.",
    },
    servers: [{ url: "/api/v1" }],
    tags: [
      "Auth",
      "Profile",
      "Users",
      "Chat",
      "Groups",
      "Status",
      "Snippets",
      "Live code",
      "Presence",
      "Notifications",
      "Reports",
      "Admin",
    ].map((name) => ({ name })),
  });
  // Plain JSON, exactly what clients receive.
  cached ??= JSON.parse(JSON.stringify(generated));
  return cached;
}
