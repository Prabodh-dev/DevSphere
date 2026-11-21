import { errorBody } from "../utils/apiError.js";

// Raised for bad client input; the message is safe to send back.
export class SocketInputError extends Error {
  constructor(message, code = "VALIDATION_ERROR", details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// socket-error payload: { event, error: { code, message, details? } }
export const socketError = (event, code, message, details) => ({
  event,
  ...errorBody(code, message, details),
});

export const parse = (schema, payload) => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new SocketInputError(
      "Invalid payload",
      "VALIDATION_ERROR",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }))
    );
  }
  return result.data;
};
