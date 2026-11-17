import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";

// (The users helper imports the app, so it is not used here.)
const ORIGIN = "https://app.example.test";

// Limits are read when the app is created, so set them before importing it.
process.env.REFRESH_RATE_LIMIT_MAX = "3";

const { default: app } = await import("../app.js");

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe("refresh rate limit", () => {
  it("limits the refresh endpoint", async () => {
    const attempt = () =>
      request(app)
        .post("/api/v1/auth/refresh")
        .set("Origin", ORIGIN)
        .set("Cookie", "refresh_token=nothing-valid");

    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt()).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });
});
