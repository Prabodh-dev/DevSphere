import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { withEnv } from "./helpers/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT = 4;
const ROUTERS = [
  "/chat",
  "/presence",
  "/snippets",
  "/notifications",
  "/status",
  "/group",
];
const SOME_ID = "665f1c2a9b1e8a0012a4c001";

let app;
let mounts;

// The real app, built with a small request limit. It reads its settings when
// it is built, so the environment is put back straight after.
beforeAll(async () => {
  await withEnv({ RATE_LIMIT_MAX: String(LIMIT) }, async () => {
    vi.resetModules();
    app = (await import("../app.js")).default;
    mounts = (await import("../routes/index.js")).mounts;
  });
  // Each route gets its own client address.
  app.set("trust proxy", true);
});

// "METHOD /api/v1/... " for every route of the given routers.
function routesOf(prefixes) {
  const found = [];
  for (const [prefix, router] of mounts) {
    if (!prefixes.includes(prefix)) continue;
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const route = `/api/v1${prefix}${layer.route.path === "/" ? "" : layer.route.path}`;
      for (const method of Object.keys(layer.route.methods)) {
        found.push({
          method,
          url: route.replace(/:\w+/g, SOME_ID),
        });
      }
    }
  }
  return found;
}

let nextClient = 1;
const send = (route, client) =>
  request(app)
    [route.method](route.url)
    .set("X-Forwarded-For", client)
    .send(route.method === "get" ? undefined : {});

describe("rate limits on the chat and presence routes", () => {
  it("finds the routes of both routers", () => {
    const routes = routesOf(ROUTERS).map((r) => `${r.method} ${r.url}`);
    expect(routes.length).toBeGreaterThanOrEqual(12);
    expect(
      routes.some((r) => r.startsWith("put ") && r.endsWith("/read"))
    ).toBe(true);
    expect(routes.some((r) => r.endsWith("/presence"))).toBe(true);
  });

  it("answers 429 on every route once the limit is exceeded", async () => {
    for (const route of routesOf(ROUTERS)) {
      const client = `10.1.0.${nextClient++}`;
      const statuses = [];
      for (let i = 0; i < LIMIT + 2; i++) {
        statuses.push((await send(route, client)).status);
      }
      const label = `${route.method} ${route.url}`;
      // The first requests reach the route (they fail on login, which is
      // fine here), the rest are refused by the limiter.
      expect(statuses.slice(0, LIMIT), label).not.toContain(429);
      expect(statuses.slice(LIMIT), label).toEqual([429, 429]);
    }
  });

  it("sends the standard error body and headers when limited", async () => {
    const route = routesOf(ROUTERS)[0];
    const client = `10.1.0.${nextClient++}`;
    let res;
    for (let i = 0; i < LIMIT + 1; i++) res = await send(route, client);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.headers["ratelimit"]).toBeDefined();
  });

  it("counts each request once, not once per limiter", async () => {
    const route = routesOf(ROUTERS)[0];
    const client = `10.1.0.${nextClient++}`;
    const remaining = [];
    for (let i = 0; i < 3; i++) {
      const res = await send(route, client);
      remaining.push(
        Number(/remaining=(\d+)/.exec(res.headers["ratelimit"])[1])
      );
    }
    expect(remaining).toEqual([LIMIT - 1, LIMIT - 2, LIMIT - 3]);
  });
});

describe("the routers", () => {
  it("apply the limiter where the routes are declared", () => {
    for (const file of [
      "routes/chatRoutes.js",
      "routes/presenceRoutes.js",
      "routes/snippetRoutes.js",
      "routes/notificationRoutes.js",
      "routes/statusRoutes.js",
      "routes/groupRoutes.js",
    ]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).toMatch(/router\.use\(\s*limiters\.general\s*\)/);
    }
  });
});
