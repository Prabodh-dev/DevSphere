import { HttpError } from "../utils/httpError.js";
import { errorBody, sendError } from "../utils/apiError.js";

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
// logged briefly; only unexpected failures are logged as errors.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const { status, code, message, details, unexpected } = describe(err);
  const where = `${req.method} ${req.originalUrl}`;

  if (unexpected) {
    console.error(`Unexpected error on ${where}:`, err);
  } else if (status >= 500) {
    console.warn(`${status} ${code} on ${where}`);
  } else {
    console.info(`${status} ${code} on ${where}`);
  }

  res.status(status).json(errorBody(code, message, details));
};
