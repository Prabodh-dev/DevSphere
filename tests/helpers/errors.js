import { expect } from "vitest";

// Every error response has exactly this shape: { error: { code, message, details? } }.
export function expectError(res, status, code, message) {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(["error"]);

  const { error } = res.body;
  expect([
    "code,message,requestId",
    "code,details,message,requestId",
  ]).toContain(Object.keys(error).sort().join());
  expect(error.requestId).toBe(res.headers["x-request-id"]);
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  if (message !== undefined) expect(error.message).toBe(message);

  // Nothing internal is ever included.
  expect(JSON.stringify(res.body)).not.toMatch(
    /stack|node_modules|\bat .*\(.*:\d+/
  );
  return error;
}
