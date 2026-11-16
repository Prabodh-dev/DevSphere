import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

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

// Starts server.js with an explicit environment. Empty strings stop dotenv
// from filling in values from a local .env file.
function startServer(env) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { PATH: process.env.PATH, ...env },
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

describe("server startup", () => {
  it("exits with an error when required variables are missing", async () => {
    const { exited, output } = startServer({ MONGO_URI: "", JWT_SECRET: "" });
    const { code } = await exited;

    expect(code).not.toBe(0);
    expect(output()).toContain("MONGO_URI");
    expect(output()).toContain("JWT_SECRET");
  });

  it("exits with an error when the JWT secret is too short", async () => {
    const { exited, output } = startServer({
      MONGO_URI: process.env.TEST_MONGO_URI,
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

  it("serves /healthz and shuts down cleanly on SIGTERM", async () => {
    const port = await freePort();
    const { child, exited } = startServer({
      MONGO_URI: process.env.TEST_MONGO_URI,
      JWT_SECRET: "test-only-secret-that-is-long-enough-123",
      PORT: String(port),
      REDIS_URL: process.env.REDIS_URL,
    });

    await waitForHealthy(port);
    child.kill("SIGTERM");
    const { code } = await exited;
    expect(code).toBe(0);
  }, 30000);
});
