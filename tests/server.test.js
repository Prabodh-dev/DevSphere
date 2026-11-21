import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { controlledEnv } from "./helpers/env.js";
import { dropTestDb, testMongoUri } from "./helpers/db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Starts server.js with a controlled environment: every documented variable is
// blank unless the test sets it, so a local .env file cannot leak in.
function startServer(env) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: controlledEnv(env),
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal }))
  );
  return { child, exited, output: () => output };
}

async function waitForHealthy(port, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

afterAll(dropTestDb);

describe("server startup", () => {
  it("exits with an error when required variables are missing", async () => {
    const { exited, output } = startServer({});
    const { code } = await exited;

    expect(code).not.toBe(0);
    expect(output()).toContain("MONGO_URI is required");
    expect(output()).toContain("JWT_SECRET is required");
  });

  it("exits with an error when the JWT secret is too short", async () => {
    const { exited, output } = startServer({
      MONGO_URI: testMongoUri(),
      JWT_SECRET: "short",
    });
    const { code } = await exited;

    expect(code).not.toBe(0);
    expect(output()).toContain("JWT_SECRET must be at least 32 characters");
  });

  it("exits with an error when the database is unreachable", async () => {
    const { exited } = startServer({
      MONGO_URI: "mongodb://127.0.0.1:1/devsphere_test",
      JWT_SECRET: "test-only-secret-that-is-long-enough-123",
      PORT: String(await freePort()),
    });
    const { code } = await exited;
    expect(code).not.toBe(0);
  }, 30000);

  it("starts and serves /healthz with every upload setting blank", async () => {
    const port = await freePort();
    const { child, exited, output } = startServer({
      MONGO_URI: testMongoUri(),
      JWT_SECRET: "test-only-secret-that-is-long-enough-123",
      PORT: String(port),
      REDIS_URL: process.env.REDIS_URL,
      AWS_ACCESS_KEY: "",
      AWS_SECRET_KEY: "",
      AWS_REGION: "",
      AVATAR_BUCKET: "",
    });

    await waitForHealthy(port);
    expect(output()).not.toMatch(/region is missing/i);

    child.kill();
    await exited;
  }, 30000);

  it("warns at startup about TRUST_PROXY=true, and not about a hop count", async () => {
    const run = async (value) => {
      const port = await freePort();
      const { child, exited, output } = startServer({
        MONGO_URI: testMongoUri(),
        JWT_SECRET: "test-only-secret-that-is-long-enough-123",
        PORT: String(port),
        TRUST_PROXY: value,
      });
      await waitForHealthy(port);
      child.kill();
      await exited;
      return output();
    };

    const risky = await run("true");
    expect(risky).toContain("TRUST_PROXY=true");
    expect(
      JSON.parse(risky.split("\n").find((l) => l.includes("TRUST_PROXY=true")))
        .level
    ).toBe("warn");
    expect(await run("1")).not.toContain("TRUST_PROXY=true");
  }, 60000);

  // Windows terminates the child immediately instead of delivering SIGTERM.
  it.skipIf(process.platform === "win32")(
    "shuts down cleanly on SIGTERM",
    async () => {
      const port = await freePort();
      const { child, exited } = startServer({
        MONGO_URI: testMongoUri(),
        JWT_SECRET: "test-only-secret-that-is-long-enough-123",
        PORT: String(port),
        REDIS_URL: process.env.REDIS_URL,
      });

      await waitForHealthy(port);
      child.kill("SIGTERM");
      const { code } = await exited;
      expect(code).toBe(0);
    },
    30000
  );
});
