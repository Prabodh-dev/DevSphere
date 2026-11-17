import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { expectError } from "./helpers/errors.js";

// The setting is read when the app is created.
async function appWith(env) {
  vi.resetModules();
  const mongoose = (await import("mongoose")).default;
  for (const name of mongoose.modelNames()) mongoose.deleteModel(name);
  Object.assign(process.env, { NODE_ENV: "test", DOCS_ENABLED: "", ...env });
  return (await import("../app.js")).default;
}

describe("DOCS_ENABLED", () => {
  it("turns the docs off when false", async () => {
    const app = await appWith({ DOCS_ENABLED: "false" });
    for (const path of [
      "/api/v1/docs",
      "/api/v1/openapi.json",
      "/api/v1/docs/assets/init.js",
    ]) {
      expectError(await request(app).get(path), 404, "NOT_FOUND");
    }
  });

  it("is on by default outside production", async () => {
    const app = await appWith({ NODE_ENV: "development" });
    expect((await request(app).get("/api/v1/docs")).status).toBe(200);
  });

  it("is off by default in production", async () => {
    const app = await appWith({ NODE_ENV: "production" });
    expect((await request(app).get("/api/v1/docs")).status).toBe(404);
    expect((await request(app).get("/api/v1/openapi.json")).status).toBe(404);
  });

  it("can be switched on in production", async () => {
    const app = await appWith({ NODE_ENV: "production", DOCS_ENABLED: "true" });
    expect((await request(app).get("/api/v1/openapi.json")).status).toBe(200);
  });
});
