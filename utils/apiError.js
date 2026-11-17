// The one shape of every error response: { error: { code, message, details? } }
export const errorBody = (code, message, details) => ({
  error: {
    code,
    message,
    ...(details !== undefined && { details }),
  },
});

export const sendError = (res, status, code, message, details) =>
  res.status(status).json(errorBody(code, message, details));
