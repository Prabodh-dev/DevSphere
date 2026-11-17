// The one shape of every error response:
// { error: { code, message, details?, requestId? } }
export const errorBody = (code, message, details, requestId) => ({
  error: {
    code,
    message,
    ...(details !== undefined && { details }),
    ...(requestId && { requestId }),
  },
});

export const sendError = (res, status, code, message, details) =>
  res
    .status(status)
    .json(
      errorBody(
        code,
        message,
        details,
        res.getHeader("X-Request-Id") ?? undefined
      )
    );
