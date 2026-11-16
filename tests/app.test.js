import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import { connectTestDb, disconnectTestDb } from "./helpers/db.js";

describe("app basics", () => {
  afterAll(async () => {
    if (mongoose.connection.readyState === 1) await disconnectTestDb();
  });

  it("GET /healthz reports 503 while the database is not connected", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", db: "down" });
  });

  it("GET /healthz reports ok once the database is connected", async () => {
    await connectTestDb();
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "up" });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ message: "Route not found" });
  });

  it("returns a clean 400 for a malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Malformed request body" });
  });
});
