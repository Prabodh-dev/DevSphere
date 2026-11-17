import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer, refreshCookieFrom } from "./helpers/users.js";

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe("API versioning", () => {
  it("serves the API under /api/v1", async () => {
    const user = await createUser();
    const res = await request(app).get("/api/v1/chat").set(bearer(user.token));
    expect(res.status).toBe(200);
  });

  it("answers unversioned /api paths with the standard 404", async () => {
    const user = await createUser();
    for (const [method, path] of [
      ["get", "/api/chat"],
      ["get", "/api/profile/me"],
      ["post", "/api/auth/login"],
      ["post", "/api/auth/refresh"],
      ["get", "/api/users"],
    ]) {
      const res = await request(app)[method](path).set(bearer(user.token));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("keeps /healthz unversioned", async () => {
    expect((await request(app).get("/healthz")).status).toBe(200);
    expect((await request(app).get("/api/v1/healthz")).status).toBe(404);
  });

  it("limits the refresh cookie to the versioned auth path", async () => {
    const user = await createUser();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password });
    expect(refreshCookieFrom(res)).toBeDefined();
    const header = res.headers["set-cookie"].find((c) =>
      c.startsWith("refresh_token=")
    );
    expect(header).toMatch(/Path=\/api\/v1\/auth(;|$)/);
  });
});
