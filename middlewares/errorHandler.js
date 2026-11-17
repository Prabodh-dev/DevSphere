import { HttpError } from "../utils/httpError.js";
import { errorBody, sendError } from "../utils/apiError.js";
import { logger } from "../utils/logger.js";

export const notFoundHandler = (req, res) => {
  sendError(res, 404, "NOT_FOUND", "Route not found");
};

// What an error looks like to a client. Nothing from the original error's
// message or stack is ever included for errors we did not raise ourselves.
function describe(err) {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }
  if (err.type === "entity.parse.failed") {
    return {
      status: 400,
      code: "MALFORMED_REQUEST",
      message: "Malformed request body",
    };
  }
  if (err.type === "entity.too.large") {
    return {
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body too large",
    };
  }
  if (err.name === "CastError") {
    return { status: 400, code: "VALIDATION_ERROR", message: "Invalid id" };
  }
  if (err.name === "ValidationError") {
    return { status: 400, code: "VALIDATION_ERROR", message: "Invalid input" };
  }
  if (err.code === 11000) {
    return {
      status: 409,
      code: "CONFLICT",
      message: "Resource already exists",
    };
  }
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: "File too large",
      };
    }
    return { status: 400, code: "VALIDATION_ERROR", message: "Invalid upload" };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    unexpected: true,
  };
}

// Single place where errors become responses. Expected client errors are
// logged by the request logger at info; only unexpected failures are logged
// here, as errors, with the error itself.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const { status, code, message, details, unexpected } = describe(err);

  res.locals.errorCode = code;
  if (unexpected) {
    res.locals.unexpectedError = true;
    (req.log ?? logger).error(
      {
        err,
        requestId: req.id,
        method: req.method,
        route: req.originalUrl.split("?")[0],
      },
      "Unexpected error"
    );
  } else if (status >= 500) {
    // An expected condition, such as uploads that are not configured.
    res.locals.unexpectedError = true;
    res.locals.expectedServerError = true;
  }

  res
    .status(status)
    .json(
      errorBody(code, message, details, res.getHeader("X-Request-Id") ?? req.id)
    );
};
