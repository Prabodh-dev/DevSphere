import { describe, it, expect, vi, afterEach } from "vitest";
import { errorHandler } from "../middlewares/errorHandler.js";
import { HttpError } from "../utils/httpError.js";

function run(err) {
  const res = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  errorHandler(err, { method: "GET", originalUrl: "/x" }, res, next);
  return { res, next };
}

afterEach(() => vi.restoreAllMocks());

describe("errorHandler", () => {
  it("hides internal error details and logs them", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = run(new Error("connection string mongodb://secret-host"));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Internal server error" });
    expect(spy).toHaveBeenCalled();
  });

  it("passes through HttpError messages", () => {
    const { res } = run(new HttpError(403, "Nope"));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Nope" });
  });

  it.each([
    [
      { name: "CastError", message: "Cast to ObjectId failed for value x" },
      400,
    ],
    [{ name: "ValidationError", message: "path `x` is required" }, 400],
    [{ code: 11000, message: "E11000 duplicate key" }, 409],
    [{ name: "MulterError", message: "File too large" }, 400],
  ])("maps library errors to a generic client error", (err, status) => {
    const { res } = run(err);
    expect(res.status).toHaveBeenCalledWith(status);
    const [body] = res.json.mock.calls[0];
    expect(Object.keys(body)).toEqual(["message"]);
    expect(body.message).not.toContain(err.message);
  });
});
