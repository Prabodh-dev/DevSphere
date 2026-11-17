import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { bearer } from "./helpers/users.js";

const credentials = {
  username: "alice",
  email: "alice@example.test",
  password: "password-for-tests-1",
};

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

describe("auth flow (current behaviour)", () => {
  it("registers a user and returns a signed token without the password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(credentials);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      username: "alice",
      email: "alice@example.test",
    });
    expect(res.body.password).toBeUndefined();

    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload.userId).toBe(res.body._id);
  });

  it("rejects a duplicate email", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...credentials, username: "alice2" });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Email already used");
  });

  it("logs in with correct credentials", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: credentials.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it("returns 401 for a wrong password and for an unknown email", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);

    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: credentials.email, password: "not-the-password" });
    expect(wrong.status).toBe(401);

    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.test", password: "x" });
    expect(unknown.status).toBe(401);
  });

  it("guards protected routes with a bearer token", async () => {
    const none = await request(app).get("/api/v1/profile/me");
    expect(none.status).toBe(401);
    expect(none.body.error.message).toBe("No token provided");

    const bad = await request(app)
      .get("/api/v1/profile/me")
      .set(bearer("not-a-token"));
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe("Invalid token");

    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send(credentials);
    const ok = await request(app)
      .get("/api/v1/profile/me")
      .set(bearer(reg.body.token));
    // Authenticated, but no profile has been created yet.
    expect(ok.status).toBe(404);
    expect(ok.body.error.message).toBe("Profile not found");
  });
});

describe("registration and login validation", () => {
  it("normalises the email so login works with any casing", async () => {
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...credentials, email: "  Alice@Example.TEST " });
    expect(reg.status).toBe(201);
    expect(reg.body.email).toBe("alice@example.test");

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ALICE@example.test", password: credentials.password });
    expect(login.status).toBe(200);
  });

  it("treats emails that differ only by case as duplicates", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...credentials, username: "other", email: "ALICE@example.test" });
    expect(res.status).toBe(409);
  });

  it("returns 409 for a taken username", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...credentials, email: "second@example.test" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("Username already taken");
  });

  it.each([
    ["missing password", { ...credentials, password: undefined }],
    ["short password", { ...credentials, password: "short" }],
    ["non-string password", { ...credentials, password: 12345678 }],
    ["missing username", { ...credentials, username: undefined }],
    ["invalid email", { ...credentials, email: "not-an-email" }],
    ["non-string email", { ...credentials, email: { value: "x" } }],
  ])("rejects registration with %s", async (_label, body) => {
    const res = await request(app).post("/api/v1/auth/register").send(body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(["error"]);
  });

  it("rejects login bodies that are not plain strings", async () => {
    await request(app).post("/api/v1/auth/register").send(credentials);

    const objectEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: { value: "x" }, password: credentials.password });
    expect(objectEmail.status).toBe(400);

    const missing = await request(app).post("/api/v1/auth/login").send({});
    expect(missing.status).toBe(400);
  });
});
