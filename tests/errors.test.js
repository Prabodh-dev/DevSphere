import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";
import app from "../app.js";
import User from "../models/User.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, makeAdmin, bearer } from "./helpers/users.js";
import { expectError } from "./helpers/errors.js";

let alice;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
});

describe("error responses", () => {
  it("use one shape for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expectError(res, 404, "NOT_FOUND", "Route not found");
  });

  it("report every failing field for invalid input", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "x",
      email: "not-an-email",
      password: "short",
    });
    const error = expectError(res, 400, "VALIDATION_ERROR");
    expect(error.message).toBe("Request validation failed");

    const fields = error.details.map((d) => d.field).sort();
    expect(fields).toEqual(["email", "password", "username"]);
    for (const detail of error.details) {
      expect(Object.keys(detail).sort()).toEqual([
        "field",
        "location",
        "message",
      ]);
      expect(detail.location).toBe("body");
      expect(typeof detail.message).toBe("string");
    }
  });

  it("name the location of invalid params and query values", async () => {
    const params = await request(app).get("/api/v1/profile/not-an-id");
    const paramError = expectError(params, 400, "VALIDATION_ERROR");
    expect(paramError.details).toEqual([
      { field: "userId", location: "params", message: expect.any(String) },
    ]);

    const query = await request(app)
      .get("/api/v1/users")
      .set(bearer(alice.token));
    const queryError = expectError(query, 400, "VALIDATION_ERROR");
    expect(queryError.details[0]).toMatchObject({
      field: "tag",
      location: "query",
    });
  });

  it("use UNAUTHENTICATED for missing and invalid tokens", async () => {
    expectError(await request(app).get("/api/v1/chat"), 401, "UNAUTHENTICATED");
    expectError(
      await request(app).get("/api/v1/chat").set(bearer("garbage")),
      401,
      "UNAUTHENTICATED"
    );
    expectError(
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.test", password: "whatever-1" }),
      401,
      "UNAUTHENTICATED"
    );
  });

  it("use FORBIDDEN and ACCOUNT_BLOCKED for refused requests", async () => {
    expectError(
      await request(app).get("/api/v1/admin/users").set(bearer(alice.token)),
      403,
      "FORBIDDEN"
    );

    await User.updateOne({ _id: alice.id }, { isBlocked: true });
    expectError(
      await request(app).get("/api/v1/chat").set(bearer(alice.token)),
      403,
      "ACCOUNT_BLOCKED"
    );
    expectError(
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: alice.email, password: alice.password }),
      403,
      "ACCOUNT_BLOCKED"
    );
  });

  it("use NOT_FOUND and CONFLICT", async () => {
    expectError(
      await request(app)
        .get("/api/v1/users/507f1f77bcf86cd799439011/followers")
        .set(bearer(alice.token)),
      404,
      "NOT_FOUND"
    );
    expectError(
      await request(app).post("/api/v1/auth/register").send({
        username: "another",
        email: alice.email,
        password: "a-good-passw0rd",
      }),
      409,
      "CONFLICT"
    );
  });

  it("handle malformed and oversized bodies", async () => {
    expectError(
      await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send('{"email": '),
      400,
      "MALFORMED_REQUEST"
    );
    expectError(
      await request(app)
        .post("/api/v1/snippets/highlight")
        .send({ code: "a".repeat(400 * 1024) }),
      413,
      "PAYLOAD_TOO_LARGE"
    );
  });

  it("use FORBIDDEN for chats the user is not in", async () => {
    const admin = await makeAdmin(await createUser());
    const missing = await request(app)
      .get("/api/v1/chat/message/507f1f77bcf86cd799439011")
      .set(bearer(admin.token));
    expectError(missing, 404, "NOT_FOUND");
  });
});

describe("error handler", () => {
  const run = (err) => {
    const res = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    errorHandler(err, { method: "GET", originalUrl: "/x" }, res, vi.fn());
    return res;
  };

  let spies;
  beforeEach(() => {
    spies = {
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it("hides unexpected errors behind INTERNAL_ERROR", () => {
    const res = run(new Error("connection string with secret-host"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("secret-host");
  });

  it("maps library errors to stable codes", () => {
    const cases = [
      [{ name: "CastError", message: "x" }, 400, "VALIDATION_ERROR"],
      [{ name: "ValidationError", message: "x" }, 400, "VALIDATION_ERROR"],
      [{ code: 11000, message: "x" }, 409, "CONFLICT"],
      [
        { name: "MulterError", code: "LIMIT_FILE_SIZE", message: "x" },
        413,
        "PAYLOAD_TOO_LARGE",
      ],
      [
        { name: "MulterError", code: "LIMIT_UNEXPECTED_FILE", message: "x" },
        400,
        "VALIDATION_ERROR",
      ],
      [{ type: "entity.parse.failed", message: "x" }, 400, "MALFORMED_REQUEST"],
      [{ type: "entity.too.large", message: "x" }, 413, "PAYLOAD_TOO_LARGE"],
    ];
    for (const [err, status, code] of cases) {
      const res = run(err);
      expect(res.status).toHaveBeenCalledWith(status);
      const [body] = res.json.mock.calls[0];
      expect(body.error.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain('"x"');
    }
  });

  it("logs client errors quietly and unexpected errors as errors", async () => {
    const { notFound, uploadsNotConfigured } =
      await import("../utils/httpError.js");

    run(notFound("nope"));
    expect(spies.info).toHaveBeenCalledTimes(1);
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();

    run(uploadsNotConfigured());
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.error).not.toHaveBeenCalled();

    run(new Error("boom"));
    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(String(spies.error.mock.calls[0][0])).toMatch(/Unexpected error/);
  });

  it("does not log 4xx responses as unhandled errors", async () => {
    await request(app).get("/api/v1/chat");
    await request(app).get("/api/v1/nothing-here");
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalled();
  });
});
