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
  return {
    id: res.body._id,
    token: res.body.token,
    cookie: refreshCookieFrom(res),
    ...body,
  };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// Promotes a user to admin directly in the database (like the make-admin script).
export async function makeAdmin(user) {
  const { default: User } = await import("../../models/User.js");
  await User.updateOne({ _id: user.id }, { role: "admin" });
  return user;
}

export const ORIGIN = "https://app.example.test";

// Reads the refresh cookie (name=value) from a response, or undefined.
export function refreshCookieFrom(res) {
  const cookies = res.headers["set-cookie"] ?? [];
  const line = cookies.find((c) => c.startsWith("refresh_token="));
  if (!line) return undefined;
  const pair = line.split(";")[0];
  return pair === "refresh_token=" ? undefined : pair;
}

// The raw refresh token inside a cookie pair.
export const tokenFromCookie = (pair) =>
  decodeURIComponent(pair.slice("refresh_token=".length));

// Logs in and returns the access token and refresh cookie pair.
export async function loginAs(user, headers = {}) {
  const res = await request(app)
    .post("/api/auth/login")
    .set(headers)
    .send({ email: user.email, password: user.password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, cookie: refreshCookieFrom(res), res };
}
