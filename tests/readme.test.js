import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ENV_VARIABLES } from "../config/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");

describe("README", () => {
  it("documents every variable listed in .env.example", () => {
    const readme = read("README.md");

    const missing = ENV_VARIABLES.filter(
      (name) => !readme.includes(`\`${name}\``)
    );
    expect(missing).toEqual([]);
  });

  it("describes the auth endpoints", () => {
    const readme = read("README.md");
    for (const endpoint of [
      "/api/v1/auth/refresh",
      "/api/v1/auth/logout",
      "/api/v1/auth/logout-all",
      "/api/v1/auth/sessions",
      "/api/v1/auth/change-password",
    ]) {
      expect(readme).toContain(endpoint);
    }
    expect(readme).toContain("sequenceDiagram");
  });
});

describe("README data model", () => {
  it("has an ER diagram that names every model", async () => {
    const { readdirSync } = await import("fs");
    const models = readdirSync(path.join(root, "models"))
      .filter((file) => file.endsWith(".js"))
      .map((file) => file.replace(/\.js$/, ""));

    const readme = read("README.md");
    const diagram = readme.slice(readme.indexOf("erDiagram"));
    expect(diagram.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(diagram, `${model} is missing from the diagram`).toContain(model);
    }
  });

  it("explains how to run migrations and sync indexes", () => {
    const readme = read("README.md");
    for (const text of [
      "pnpm migrate",
      "--dry-run",
      "pnpm db:indexes",
      "MONGO_AUTO_INDEX",
    ]) {
      expect(readme).toContain(text);
    }
  });

  it("lists every migration", async () => {
    const { readdirSync } = await import("fs");
    const readme = read("README.md");
    const names = readdirSync(path.join(root, "migrations"))
      .filter((file) => file.endsWith(".js"))
      .map((file) => file.replace(/\.js$/, ""));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(readme, `${name} is not documented`).toContain(name);
    }
  });
});

describe("docker-compose", () => {
  it("builds indexes for the local database", () => {
    expect(read("docker-compose.yml")).toMatch(/MONGO_AUTO_INDEX:\s*"true"/);
  });
});

describe("CHANGELOG", () => {
  it("records the data model changes", () => {
    const changelog = read("CHANGELOG.md");
    for (const text of [
      "follows",
      "latestMessage",
      "pnpm migrate",
      "Breaking",
    ]) {
      expect(changelog).toContain(text);
    }
  });
});

describe("API documentation", () => {
  it("points to the docs page, the spec and the socket events", () => {
    const readme = read("README.md");
    for (const text of [
      "/api/v1/docs",
      "/api/v1/openapi.json",
      "docs/socket-events.md",
      "DOCS_ENABLED",
      "nextCursor",
      "RATE_LIMITED",
      "Retry-After",
    ]) {
      expect(readme, text).toContain(text);
    }
  });

  it("records the API contract changes in the changelog", () => {
    const changelog = read("CHANGELOG.md");
    for (const text of [
      "/api/v1",
      "error",
      "nextCursor",
      "OpenAPI",
      "socket-events.md",
      "CORS",
    ]) {
      expect(changelog, text).toContain(text);
    }
  });
});

describe("Operations documentation", () => {
  it("covers logging, request ids, metrics, health and shutdown", () => {
    const readme = read("README.md");
    expect(readme).toContain("## Operations");
    for (const text of [
      "LOG_LEVEL",
      "LOG_PRETTY",
      "X-Request-Id",
      "requestId",
      "METRICS_ENABLED",
      "METRICS_TOKEN",
      "scrape_configs",
      "http_request_duration_seconds",
      "socket_connections",
      "socket_events_total",
      "auth_refresh_total",
      "reuse_detected",
      "/healthz",
      "/readyz",
      "SIGTERM",
      "unhandled promise rejection",
      "docs/architecture.md",
    ]) {
      expect(readme, text).toContain(text);
    }
  });

  it("records the operations changes in the changelog", () => {
    const changelog = read("CHANGELOG.md");
    for (const text of [
      "pino",
      "/metrics",
      "/readyz",
      "requestId",
      "CodeQL",
      "Dependabot",
      "services/",
    ]) {
      expect(changelog, text).toContain(text);
    }
  });
});
