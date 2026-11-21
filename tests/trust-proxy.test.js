import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// The highlighter needs no database, so it can be used to watch the limiter.
const call = (app, forwardedFor) =>
  request(app)
    .post("/api/v1/snippets/highlight")
    .set("X-Forwarded-For", forwardedFor)
    .send({ code: "let a = 1;" });

async function freshApp(env) {
  vi.resetModules();
  // Re-importing the app compiles the models again.
  for (const name of mongoose.modelNames()) mongoose.deleteModel(name);
  Object.assign(process.env, {
    HIGHLIGHT_RATE_LIMIT_MAX: "2",
    TRUST_PROXY: "",
    ...env,
  });
  return (await import("../app.js")).default;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("TRUST_PROXY", () => {
  it("is ignored by default, so forwarded addresses do not matter", async () => {
    const app = await freshApp({ TRUST_PROXY: "" });
    expect(app.get("trust proxy")).toBe(0);

    expect((await call(app, "203.0.113.1")).status).toBe(200);
    expect((await call(app, "203.0.113.2")).status).toBe(200);
    // Same client as far as the app can tell, so the third call is limited.
    expect((await call(app, "203.0.113.3")).status).toBe(429);
  });

  it("lets the limiter see the real client address behind a proxy", async () => {
    const app = await freshApp({ TRUST_PROXY: "1" });
    expect(app.get("trust proxy")).toBe(1);

    expect((await call(app, "203.0.113.1")).status).toBe(200);
    expect((await call(app, "203.0.113.1")).status).toBe(200);
    expect((await call(app, "203.0.113.1")).status).toBe(429);
    // A different client behind the same proxy is not affected.
    expect((await call(app, "203.0.113.2")).status).toBe(200);
  });
});

describe("TRUST_PROXY as a list of proxies", () => {
  it("trusts forwarded addresses from a listed proxy", async () => {
    // Test requests come from the loopback address.
    const app = await freshApp({ TRUST_PROXY: "loopback" });
    expect(app.get("trust proxy")).toBe("loopback");

    expect((await call(app, "203.0.113.1")).status).toBe(200);
    expect((await call(app, "203.0.113.1")).status).toBe(200);
    expect((await call(app, "203.0.113.1")).status).toBe(429);
    expect((await call(app, "203.0.113.2")).status).toBe(200);
  });

  it("ignores forwarded addresses from a proxy that is not listed", async () => {
    const app = await freshApp({ TRUST_PROXY: "10.0.0.0/8" });

    expect((await call(app, "203.0.113.1")).status).toBe(200);
    expect((await call(app, "203.0.113.2")).status).toBe(200);
    expect((await call(app, "203.0.113.3")).status).toBe(429);
  });
});

describe("app code", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  function sources(dir) {
    const found = [];
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", "tests"].includes(name)) continue;
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) found.push(...sources(file));
      else if (name.endsWith(".js")) found.push(file);
    }
    return found;
  }

  it("never sets trust proxy to true itself", () => {
    const offenders = sources(root).filter((file) =>
      /trust proxy["']\s*,\s*true/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("only passes the configured value to Express", () => {
    const source = readFileSync(path.join(root, "app.js"), "utf8");
    expect(source).toMatch(/app\.set\("trust proxy", config\.trustProxy\)/);
  });
});
