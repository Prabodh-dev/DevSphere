import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";
import { buildOpenApiDocument } from "../openapi/spec.js";
import { expectError } from "./helpers/errors.js";

describe("API docs", () => {
  it("serve the OpenAPI document as JSON", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual(buildOpenApiDocument());
    expect(res.body.openapi).toBe("3.1.0");
  });

  it("serve an interactive page that loads its own assets", async () => {
    const page = await request(app).get("/api/v1/docs");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.text).toContain("/api/v1/docs/assets/swagger-ui-bundle.js");
    expect(page.text).toContain("/api/v1/docs/assets/swagger-ui.css");
    // No inline scripts and nothing from other sites.
    expect(page.text).not.toMatch(/<script(?![^>]*src=)/);
    expect(page.text).not.toMatch(/https?:\/\//);

    const init = await request(app).get("/api/v1/docs/assets/init.js");
    expect(init.status).toBe(200);
    expect(init.headers["content-type"]).toMatch(/javascript/);
    expect(init.text).toContain("/api/v1/openapi.json");

    for (const [file, type] of [
      ["swagger-ui-bundle.js", /javascript/],
      ["swagger-ui.css", /css/],
    ]) {
      const res = await request(app).get(`/api/v1/docs/assets/${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers["content-type"], file).toMatch(type);
    }
  });

  it("only serve the files the page needs", async () => {
    for (const path of [
      "/api/v1/docs/assets/package.json",
      "/api/v1/docs/assets/../package.json",
      "/api/v1/docs/assets/index.html",
      "/api/v1/docs/assets/swagger-initializer.js",
    ]) {
      expect((await request(app).get(path)).status, path).toBe(404);
    }
  });

  it("have their own content security policy, leaving the rest strict", async () => {
    const docs = (await request(app).get("/api/v1/docs")).headers[
      "content-security-policy"
    ];
    expect(docs).toContain("script-src 'self'");
    expect(docs).toContain("connect-src 'self'");
    expect(docs).toContain("object-src 'none'");
    expect(docs).toContain("frame-ancestors 'none'");
    expect(docs).not.toContain("unsafe-eval");

    // Other routes keep helmet's defaults, with no connect-src of their own.
    for (const path of ["/healthz", "/api/v1/chat", "/api/v1/openapi.json"]) {
      const csp = (await request(app).get(path)).headers[
        "content-security-policy"
      ];
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).not.toBe(docs);
    }
    const health = (await request(app).get("/healthz")).headers[
      "content-security-policy"
    ];
    expect(health).not.toContain("connect-src");
  });

  it("are not available unversioned", async () => {
    expectError(await request(app).get("/api/docs"), 404, "NOT_FOUND");
    expectError(await request(app).get("/api/openapi.json"), 404, "NOT_FOUND");
  });
});
