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

### Breaking

- Access tokens now expire after 15 minutes. Tokens issued before this change are rejected, so everyone signs in once more.
- Clients must refresh with the cookie (and send credentials from an allowed origin), and reconnect sockets with the new access token.
- Login and register responses include `expiresIn`.
- Profile responses: `user` is `{ _id, username }`, and `avatar` and `tags` come from the user record. Chat list entries have a `latestMessage` preview.
- `GET /api/admin/reports` lists open reports by default (`?status=all` for everything), and `DELETE /api/admin/remove/:type/:id` now accepts `user`.
- `POST /api/report` returns 404 for unknown targets and 409 for a repeat open report.
- The Docker image runs with `NODE_ENV=production`, so indexes are no longer built at startup; run `pnpm db:indexes`.
- Paths: `/api/...` becomes `/api/v1/...`.
- Errors: `{ message }` becomes `{ error: { code, message, details? } }`; the `socket-error` event is `{ event, error }`.
- Lists: plain arrays and `{ count, statuses }` become `{ items, nextCursor }`; `GET /api/v1/chat/message/:chatId` is newest first.
- The docs and OpenAPI routes are not served in production unless `DOCS_ENABLED=true`.
