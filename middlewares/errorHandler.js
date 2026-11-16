import { HttpError } from "../utils/httpError.js";

export const notFoundHandler = (req, res) => {
  res.status(404).json({ message: "Route not found" });
};

// Single place where errors become responses. Details are logged on the
// server and never sent to the client.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = 500;
  let message = "Internal server error";

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed request body";
  } else if (err.type === "entity.too.large") {
    status = 413;
    message = "Request body too large";
  } else if (err.name === "CastError") {
    status = 400;
    message = "Invalid id";
  } else if (err.name === "ValidationError") {
    status = 400;
    message = "Invalid input";
  } else if (err.code === 11000) {
    status = 409;
    message = "Resource already exists";
  } else if (err.name === "MulterError") {
    status = 400;
    message = "Invalid upload";
  }

  if (status >= 500) {
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  }

  res.status(status).json({ message });
};
