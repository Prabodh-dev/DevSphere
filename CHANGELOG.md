# Changelog

## Unreleased

### Sessions

- Login and registration return a 15 minute access token (`ACCESS_TOKEN_TTL`) and set an `httpOnly` refresh cookie (`REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE`). Only a hash of the refresh token is stored.
- New endpoints: `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/change-password`.
- Refresh tokens rotate on every use. Reusing an old token ends that login; a repeat within 10 seconds is only rejected.
- Refresh and logout require an `Origin` listed in `CORS_ORIGINS`. Refresh has its own rate limit (`REFRESH_RATE_LIMIT_MAX`).
- Blocking a user or changing a password revokes sessions; sockets are closed when their access token expires or their login ends.
- `TRUST_PROXY` is applied to Express (default `0`).

### Data model

- Follows are stored in their own `follows` collection (unique `follower`/`following` pair), so following is atomic and race safe. Followers and following lists take `limit` and `skip`; profiles show `followersCount` and `followingCount`.
- The user owns `username`, `avatarKey` and `tags`. Profiles only keep `bio` and links, and profile responses read the rest from the user.
- Chats keep a `latestMessage`; `GET /api/chat` orders by recent activity and returns `latestMessage` as `{ sender, preview, createdAt }` (`[code]` for code messages).
- New indexes for messages, chats, notifications, statuses, reports, and a unique index on live code per chat. `pnpm db:indexes` syncs them, and `MONGO_AUTO_INDEX` controls building them at startup (off by default in production).
- Reports are checked against their target, repeat open reports from the same user are refused (409), and an admin action marks reports `resolved` instead of deleting them. Removing a reported user blocks the account.
- Users have `createdAt` and `updatedAt`; messages need a chat and a sender; more length and enum limits.
- `pnpm migrate` (with `--dry-run`) runs ordered, repeatable migrations 001 to 006. Run it, then `pnpm db:indexes`, when upgrading an existing database.

### API contract

- All routes moved under `/api/v1`. Unversioned `/api/...` paths return the standard 404 error. `/healthz` is not versioned, and the refresh cookie path is now `/api/v1/auth`.
- Every error response is `{ "error": { "code", "message", "details"? } }` with stable codes (`VALIDATION_ERROR`, `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `ACCOUNT_BLOCKED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`, `UPLOADS_NOT_CONFIGURED`, `INVALID_CURSOR`, `INTERNAL_ERROR`). Validation errors list every failing field as `{ field, location, message }`. The same shape is used for rate limits, upload errors and the socket `socket-error` event (`{ event, error }`).
- Expected client errors are logged with `console.info`, an unconfigured upload with `console.warn`, and only unexpected failures as errors.
- Cursor pagination on chats, chat messages, notifications, the status feed, tag search, followers, following, admin users and admin reports: `limit` (default 30, at most 100) and `cursor`, answered with `{ items, nextCursor }`. Chat messages are newest first. The `skip` parameter of the followers and following lists is gone.
- An OpenAPI 3.1 document built from the validation schemas at `/api/v1/openapi.json`, with interactive docs at `/api/v1/docs` (own content security policy; controlled by `DOCS_ENABLED`, off by default in production).
- `docs/socket-events.md` describes the socket handshake, events, payloads and limits; a test keeps the event names in step with the code.
- CORS: credentials are allowed only for origins in `CORS_ORIGINS`, preflight requests are answered, only `Content-Type` and `Authorization` request headers are allowed, and `RateLimit`, `RateLimit-Policy` and `Retry-After` are exposed. Limited requests carry `Retry-After`.

### Operations and structure

- Logging with pino: JSON lines (readable with `LOG_PRETTY=true`), `LOG_LEVEL`, one line per request with method, route pattern, status, duration and request id, secrets redacted. Expected 4xx stay at info, unexpected errors are logged as errors. Socket logs carry the connection id and verified user id. No `console` calls remain in the app.
- Request ids: `X-Request-Id` is accepted when it is short and safe, otherwise generated, returned on every response and included as `requestId` in every error body (also in the OpenAPI error schema).
- Prometheus metrics at `/metrics` when `METRICS_ENABLED=true` (optional bearer `METRICS_TOKEN`): process metrics, HTTP duration histogram, socket gauge and event counter, refresh outcome counter. Labels never hold user data.
- `GET /readyz` (200 only when MongoDB is connected, Redis reported as a field). The Docker `HEALTHCHECK` now uses it. `/healthz` is unchanged.
- The process logs and exits 1 after an unhandled rejection or uncaught exception, after trying a graceful shutdown with a 10 second limit.
- One config module reads and validates every environment variable once at startup; invalid values (for example a bad `PORT` or `LOG_LEVEL`) now stop the server with a clear message. The `.env.example` and README tests read the variable list from it.
- Business logic moved from controllers into `services/`, and the chat and group controllers were renamed to match their content. `docs/architecture.md` describes the layers, and a test checks the import rules.
- CI: concurrency cancels superseded runs, a `pnpm audit --prod` step (high and critical), a Docker job that builds the image, starts the compose stack, waits for `/readyz` and checks register and login, a CodeQL workflow, Dependabot for npm (pnpm), GitHub Actions and Docker, and actions pinned to current commit SHAs.
- `dotenv` no longer prints a banner, so log output is clean.

### Real-time and scale

- Sending a message over REST or the `send-message` socket event goes through one service. It saves the message, updates the chat's latest message and delivers it from the server to the chat room and to each member's own room. A REST message now reaches connected members live. Blocked members and people who left or were removed get nothing. The socket event takes the REST body and is acknowledged with the stored message id and time. Events accept an optional acknowledgement callback.
- With `REDIS_URL`, Socket.IO uses the Redis adapter, so several instances share rooms and events. Without it the app behaves as before. `/readyz` still reports Redis as a field only.
- With `REDIS_URL`, the HTTP and socket rate limits are counted in Redis and hold across instances. Redis trouble falls back to in-memory counting with one warning. The socket limit is now counted per user rather than per connection.
- Presence counts connections per user (Redis, or memory without it), so several tabs and instances work. `user-online` and `user-offline` are sent for the first and last connection only. The last seen time is stored on the user (`lastSeenAt`). New `GET /api/v1/presence?ids=` (up to 100 ids) for yourself, people you share a chat with and people you follow.
- Live code documents have a `revision`. Edits carry `baseRevision`; a stale one gets a `code-conflict` with the current document. Accepted edits are broadcast with the new revision, and saved to MongoDB after `LIVE_CODE_FLUSH_MS`, on disconnect and on shutdown. No migration is needed: a stored document without a revision counts as revision 0.
- Read markers per member and chat (`PUT /api/v1/chat/{chatId}/read`, `mark-read`), forward only, announced as `read-receipt`, and `unreadCount` in the chat list. New `chatreads` collection (run `pnpm db:indexes`).
- Removing a member, blocking a user or ending a login now also closes the local sockets when Redis is unreachable.
- Docs: a Scaling section in the README, and the new events in `docs/socket-events.md`.

### Product features

- Chat media: `POST /api/v1/chat/media` sends an image (JPEG, PNG, WebP, GIF) or a PDF or ZIP file to a chat or group. It reuses the private bucket, server-generated keys, the MIME allow-list and the magic-byte check, answers `503 UPLOADS_NOT_CONFIGURED` without storage, and limits sizes per kind (`CHAT_IMAGE_MAX_MB`, `CHAT_FILE_MAX_MB`). The message is stored with its type, key, size and file name, delivered through the normal message service, and shown as `[image]` or `[file]` in the chat list. Responses and events carry a signed link, never the key.
- Snippets: create, read, update, delete, `mine`, a user's public snippets and a public search by tag and language, with cursor pagination, public or private visibility and size limits. Public snippets can be reported and removed by admins.
- Status interactions: likes (one per user), replies and views (one per user), with `likeCount`, `replyCount`, `viewCount` and `likedByMe` on statuses, `GET` and `DELETE /api/v1/status/:id`, and removal of a status's likes, replies, views and notifications. Statuses of blocked accounts are hidden.
- Groups: leave (not for the last admin), promote and demote admins, delete a group with its messages, read markers, live code document, media files and notifications. Members who leave or are removed leave the socket rooms at once. New `group-updated` event.
- Notifications are created for new followers, status likes and replies, `@username` mentions in chats, and group additions. Nobody is notified about their own actions, repeated likes and follows collapse, and notifications about deleted content are deleted with it. New `unread-count`, mark one read and mark all read endpoints.
- Cleanup: `returnDocument: "after"` replaces the deprecated `new: true`, the adapter's subscriber and every test Redis client have an error handler, and `TRUST_PROXY` accepts a list of proxy addresses or subnets (a hop count stays the recommended value; a bare `true` logs a warning at startup).
- No migration is needed: new fields (`likeCount` and the others, `media`) read as empty on existing documents. Run `pnpm db:indexes` for the new collections.

### Breaking

- Access tokens now expire after 15 minutes. Tokens issued before this change are rejected, so everyone signs in once more.
- Clients must refresh with the cookie (and send credentials from an allowed origin), and reconnect sockets with the new access token.
- Login and register responses include `expiresIn`.
- Profile responses: `user` is `{ _id, username }`, and `avatar` and `tags` come from the user record. Chat list entries have a `latestMessage` preview.
- `GET /api/admin/reports` lists open reports by default (`?status=all` for everything), and `DELETE /api/admin/remove/:type/:id` now accepts `user`.
- `POST /api/report` returns 404 for unknown targets and 409 for a repeat open report.
- The Docker image runs with `NODE_ENV=production`, so indexes are no longer built at startup; run `pnpm db:indexes`.
- Error bodies have a new `requestId` field.
- Output: logs are JSON lines instead of plain text, and the command line scripts print through the logger.
- Invalid environment values now stop startup instead of being ignored.
- Paths: `/api/...` becomes `/api/v1/...`.
- Errors: `{ message }` becomes `{ error: { code, message, details? } }`; the `socket-error` event is `{ event, error }`.
- Lists: plain arrays and `{ count, statuses }` become `{ items, nextCursor }`; `GET /api/v1/chat/message/:chatId` is newest first.
- The docs and OpenAPI routes are not served in production unless `DOCS_ENABLED=true`.
- `send-message` no longer relays arbitrary payloads: it takes `{ chatId, type?, text?, code? }`, saves the message, and `receive-message` carries the stored message. The sender's own sockets receive it too. `group-message` is kept as another name for it.
- `code-change` needs `baseRevision`, and `code-update` carries the revision, the chat id and the editor.
- The socket rate limit is shared by all of a user's connections.
- `POST /api/v1/chat/message` no longer accepts `type: "media"`; media is sent with `POST /api/v1/chat/media`.
- Status responses gain `likeCount`, `replyCount`, `viewCount` and `likedByMe`, and `receive-message` for a media message carries `media` with a signed link.
