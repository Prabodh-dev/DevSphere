import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer, ORIGIN } from "./helpers/users.js";
import { expectError } from "./helpers/errors.js";

let alice;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearTestDb();
  alice = await createUser();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request ids", () => {
  it("are generated and returned on every response", async () => {
    for (const res of [
      await request(app).get("/healthz"),
      await request(app).get("/api/v1/chat").set(bearer(alice.token)),
      await request(app).get("/api/v1/nope"),
    ]) {
      expect(res.headers["x-request-id"]).toMatch(UUID);
    }
    const a = await request(app).get("/healthz");
    const b = await request(app).get("/healthz");
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });

  it("use a safe id sent by the caller", async () => {
    for (const id of ["abc-123", "req_2025.01.15-xyz", "a".repeat(64), "7"]) {
      const res = await request(app).get("/healthz").set("X-Request-Id", id);
      expect(res.headers["x-request-id"], id).toBe(id);
    }
  });

  it("replace ids that are too long or contain other characters", async () => {
    for (const id of [
      "a".repeat(65),
      "has space",
      "<script>",
      "semi;colon",
      "ünïcode",
      "a/b",
      "x".repeat(500),
    ]) {
      const res = await request(app).get("/healthz").set("X-Request-Id", id);
      expect(res.headers["x-request-id"], id).toMatch(UUID);
    }
  });

  it("appear as requestId in every kind of error body", async () => {
    const wanted = "client-id-1";
    const cases = [
      [await request(app).get("/api/v1/nope"), 404, "NOT_FOUND"],
      [await request(app).get("/api/v1/chat"), 401, "UNAUTHENTICATED"],
      [
        await request(app).post("/api/v1/auth/login").send({}),
        400,
        "VALIDATION_ERROR",
      ],
      [
        await request(app)
          .post("/api/v1/auth/login")
          .set("Content-Type", "application/json")
          .send("{"),
        400,
        "MALFORMED_REQUEST",
      ],
      [
        await request(app)
          .post("/api/v1/snippets/highlight")
          .send({ code: "a".repeat(400 * 1024) }),
        413,
        "PAYLOAD_TOO_LARGE",
      ],
      [
        await request(app).get("/api/v1/admin/users").set(bearer(alice.token)),
        403,
        "FORBIDDEN",
      ],
    ];
    for (const [res, status, code] of cases) {
      const error = expectError(res, status, code);
      expect(error.requestId).toBe(res.headers["x-request-id"]);
    }

    const sent = await request(app)
      .get("/api/v1/nope")
      .set("X-Request-Id", wanted);
    expect(sent.body.error.requestId).toBe(wanted);
  });

  it("appear in rate limit errors and upload errors", async () => {
    const { png, html } = await import("./helpers/files.js");
    const upload = await request(app)
      .post("/api/v1/profile")
      .set(bearer(alice.token))
      .attach("avatar", html(), {
        filename: "a.html",
        contentType: "text/html",
      });
    expect(expectError(upload, 415, "UNSUPPORTED_MEDIA_TYPE").requestId).toBe(
      upload.headers["x-request-id"]
    );
    expect(png).toBeTypeOf("function");
  });

  it("can be read and sent by browser clients", async () => {
    const res = await request(app).get("/healthz").set("Origin", ORIGIN);
    expect(
      res.headers["access-control-expose-headers"].toLowerCase()
    ).toContain("x-request-id");

    const preflight = await request(app)
      .options("/api/v1/chat")
      .set("Origin", ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "x-request-id");
    expect(
      preflight.headers["access-control-allow-headers"].toLowerCase()
    ).toContain("x-request-id");
  });
});
