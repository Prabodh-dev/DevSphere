import request from "supertest";
import app from "../../app.js";

let counter = 0;

// Registers a user through the API and returns its id and bearer token.
export async function createUser(overrides = {}) {
  counter += 1;
  const body = {
    username: `user${counter}`,
    email: `user${counter}@example.test`,
    password: "password-for-tests-1",
    ...overrides,
  };
  const res = await request(app).post("/api/auth/register").send(body);
  if (res.status !== 201) {
    throw new Error(
      `createUser failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return { id: res.body._id, token: res.body.token, ...body };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// Promotes a user to admin directly in the database (like the make-admin script).
export async function makeAdmin(user) {
  const { default: User } = await import("../../models/User.js");
  await User.updateOne({ _id: user.id }, { role: "admin" });
  return user;
}
