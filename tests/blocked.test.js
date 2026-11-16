import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import User from "../models/User.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser, bearer } from "./helpers/users.js";

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(clearTestDb);

describe("blocked accounts", () => {
  it("cannot log in", async () => {
    const user = await createUser();
    await User.updateOne({ _id: user.id }, { isBlocked: true });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it("do not learn anything from a wrong password", async () => {
    const user = await createUser();
    await User.updateOne({ _id: user.id }, { isBlocked: true });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "not-the-password-1" });
    expect(res.status).toBe(401);
  });

  it("are refused on protected routes even with a valid token", async () => {
    const user = await createUser();
    await User.updateOne({ _id: user.id }, { isBlocked: true });

    const res = await request(app).get("/api/chat").set(bearer(user.token));
    expect(res.status).toBe(403);
  });

  it("can use the API again once unblocked", async () => {
    const user = await createUser();
    await User.updateOne({ _id: user.id }, { isBlocked: true });
    await User.updateOne({ _id: user.id }, { isBlocked: false });

    const res = await request(app).get("/api/chat").set(bearer(user.token));
    expect(res.status).toBe(200);
  });
});

describe("login errors", () => {
  it("look the same for an unknown email and a wrong password", async () => {
    const user = await createUser();

    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.test", password: "password-for-tests-1" });
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "a-different-password-1" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });
});
