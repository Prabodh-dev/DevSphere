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

### Breaking

- Access tokens now expire after 15 minutes. Tokens issued before this change are rejected, so everyone signs in once more.
- Clients must refresh with the cookie (and send credentials from an allowed origin), and reconnect sockets with the new access token.
- Login and register responses include `expiresIn`.
- Profile responses: `user` is `{ _id, username }`, and `avatar` and `tags` come from the user record. Chat list entries have a `latestMessage` preview.
- `GET /api/admin/reports` lists open reports by default (`?status=all` for everything), and `DELETE /api/admin/remove/:type/:id` now accepts `user`.
- `POST /api/report` returns 404 for unknown targets and 409 for a repeat open report.
- The Docker image runs with `NODE_ENV=production`, so indexes are no longer built at startup; run `pnpm db:indexes`.
