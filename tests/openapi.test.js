import { describe, it, expect } from "vitest";
import { Validator } from "@seriousme/openapi-schema-validator";
import { mounts } from "../routes/index.js";
import { buildOpenApiDocument } from "../openapi/spec.js";

const doc = buildOpenApiDocument();
const METHODS = ["get", "post", "put", "patch", "delete"];

// "METHOD /path" for every route registered on the Express routers.
function registeredRoutes() {
  const found = [];
  for (const [prefix, router] of mounts) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const path = `${prefix}${layer.route.path === "/" ? "" : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        found.push(
          `${method.toUpperCase()} ${path.replace(/:(\w+)/g, "{$1}")}`
        );
      }
    }
  }
  return found.sort();
}

function documentedRoutes() {
  const found = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      if (item[method]) found.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return found.sort();
}

describe("OpenAPI document", () => {
  it("is valid OpenAPI 3.1", async () => {
    expect(doc.openapi).toBe("3.1.0");
    const result = await new Validator().validate(structuredClone(doc));
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("describes every registered route and nothing else", () => {
    const registered = registeredRoutes();
    expect(registered.length).toBeGreaterThan(30);
    expect(documentedRoutes()).toEqual(registered);
  });

  it("uses the /api/v1 prefix as its server", () => {
    expect(doc.servers).toEqual([{ url: "/api/v1" }]);
    expect(Object.keys(doc.paths).every((p) => p.startsWith("/"))).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("/healthz");
  });

  it("states the auth requirement of every operation", () => {
    const publicOnes = [];
    const cookie = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const label = `${method.toUpperCase()} ${path}`;
        expect(Array.isArray(op.security), label).toBe(true);
        if (op.security.length === 0) publicOnes.push(label);
        else if (op.security[0].refreshCookie) cookie.push(label);
        else expect(op.security[0].bearerAuth, label).toEqual([]);
      }
    }
    expect(publicOnes.sort()).toEqual([
      "GET /profile/{userId}",
      "POST /auth/login",
      "POST /auth/register",
      "POST /snippets/highlight",
    ]);
    expect(cookie.sort()).toEqual(["POST /auth/logout", "POST /auth/refresh"]);
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
      "bearerAuth",
      "refreshCookie",
    ]);
  });

  it("documents the error shape on every operation", () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const label = `${method.toUpperCase()} ${path}`;
        const errorStatuses = Object.keys(op.responses).filter(
          (s) => Number(s) >= 400
        );
        expect(errorStatuses, label).toContain("429");
        for (const status of errorStatuses) {
          const schema =
            op.responses[status].content["application/json"].schema;
          expect(schema.$ref, `${label} ${status}`).toBe(
            "#/components/schemas/ErrorResponse"
          );
        }
      }
    }
    const error = doc.components.schemas.ErrorResponse;
    expect(error.properties.error.required).toEqual(["code", "message"]);
    expect(error.example.error.code).toBe("VALIDATION_ERROR");
  });

  it("documents cursor pagination on every list", () => {
    const lists = [
      "/chat",
      "/chat/message/{chatId}",
      "/notifications",
      "/status/feed",
      "/users",
      "/users/{id}/followers",
      "/users/{id}/following",
      "/admin/users",
      "/admin/reports",
    ];
    for (const path of lists) {
      const op = doc.paths[path].get;
      const params = Object.fromEntries(op.parameters.map((p) => [p.name, p]));
      expect(params.limit, path).toMatchObject({
        in: "query",
        required: false,
      });
      expect(params.limit.schema).toMatchObject({
        minimum: 1,
        maximum: 100,
        default: 30,
      });
      expect(params.cursor, path).toMatchObject({
        in: "query",
        required: false,
      });

      const schema = op.responses["200"].content["application/json"].schema;
      const resolved = schema.$ref
        ? doc.components.schemas[schema.$ref.split("/").pop()]
        : schema;
      expect(Object.keys(resolved.properties).sort(), path).toEqual([
        "items",
        "nextCursor",
      ]);
      expect(resolved.properties.nextCursor.type, path).toEqual([
        "string",
        "null",
      ]);
    }
  });

  it("has request and response bodies with examples where it matters", () => {
    const login = doc.paths["/auth/login"].post;
    expect(login.requestBody.content["application/json"].example).toEqual({
      email: "ada@example.com",
      password: "a-long-passw0rd",
    });
    expect(
      doc.components.schemas.AuthResponse.example ||
        doc.components.schemas.AuthResponse
    ).toBeTruthy();

    const profile = doc.paths["/profile"].post.requestBody.content;
    expect(Object.keys(profile).sort()).toEqual([
      "application/json",
      "multipart/form-data",
    ]);
    expect(
      profile["multipart/form-data"].schema.properties.avatar
    ).toMatchObject({
      type: "string",
      format: "binary",
    });
    expect(
      doc.paths["/auth/login"].post.responses["200"].headers["Set-Cookie"]
    ).toBeDefined();
  });

  it("gives every operation a tag and a summary", () => {
    for (const item of Object.values(doc.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        expect(op.tags?.length).toBeGreaterThan(0);
        expect(op.summary).toBeTruthy();
      }
    }
  });
});
