# Changelog

## Unreleased

### Sessions

- Login and registration return a 15 minute access token (`ACCESS_TOKEN_TTL`) and set an `httpOnly` refresh cookie (`REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE`). Only a hash of the refresh token is stored.
- New endpoints: `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/change-password`.
- Refresh tokens rotate on every use. Reusing an old token ends that login; a repeat within 10 seconds is only rejected.
- Refresh and logout require an `Origin` listed in `CORS_ORIGINS`. Refresh has its own rate limit (`REFRESH_RATE_LIMIT_MAX`).
- Blocking a user or changing a password revokes sessions; sockets are closed when their access token expires or their login ends.
- `TRUST_PROXY` is applied to Express (default `0`).

### Breaking

- Access tokens now expire after 15 minutes. Tokens issued before this change are rejected, so everyone signs in once more.
- Clients must refresh with the cookie (and send credentials from an allowed origin), and reconnect sockets with the new access token.
- Login and register responses include `expiresIn`.
