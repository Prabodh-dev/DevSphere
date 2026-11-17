// Errors that are safe to show to API clients. Every one carries a stable,
// machine-readable code; details (for example the failing fields) is optional.
const CODE_FOR_STATUS = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code ?? CODE_FOR_STATUS[status] ?? "INTERNAL_ERROR";
    this.details = details;
  }
}

export const badRequest = (message = "Bad request", options) =>
  new HttpError(400, message, options);
export const unauthorized = (message = "Unauthorized", options) =>
  new HttpError(401, message, options);
export const forbidden = (message = "Forbidden", options) =>
  new HttpError(403, message, options);
export const notFound = (message = "Not found", options) =>
  new HttpError(404, message, options);
export const conflict = (message = "Conflict", options) =>
  new HttpError(409, message, options);

// details: [{ field, location, message }]
export const validationError = (
  details,
  message = "Request validation failed"
) => new HttpError(400, message, { code: "VALIDATION_ERROR", details });

export const accountBlocked = () =>
  new HttpError(403, "Account is blocked", { code: "ACCOUNT_BLOCKED" });

export const invalidCursor = () =>
  new HttpError(400, "Invalid cursor", { code: "INVALID_CURSOR" });

export const uploadsNotConfigured = () =>
  new HttpError(503, "File uploads are not configured", {
    code: "UPLOADS_NOT_CONFIGURED",
  });
