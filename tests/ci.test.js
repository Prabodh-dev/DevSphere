import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { readFileSync, statSync } from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";
import { controlledEnv } from "./helpers/env.js";
import { dropTestDb, testMongoUri } from "./helpers/db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const yaml = (file) => parse(readFileSync(path.join(root, file), "utf8"));

const ci = yaml(".github/workflows/ci.yml");
const codeql = yaml(".github/workflows/codeql.yml");
const dependabot = yaml(".github/dependabot.yml");

const allSteps = (workflow) =>
  Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);

describe("workflows", () => {
  it("pin every action to a full commit SHA", () => {
    for (const workflow of [ci, codeql]) {
      const uses = allSteps(workflow)
        .map((step) => step.uses)
        .filter(Boolean);
      expect(uses.length).toBeGreaterThan(0);
      for (const action of uses) {
        expect(action, action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });

  it("have minimal permissions", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(codeql.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(ci.jobs))
      expect(job.permissions).toBeUndefined();

    // Only the CodeQL job may write, and only security events.
    const jobs = Object.values(codeql.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].permissions).toEqual({
      contents: "read",
      "security-events": "write",
    });
  });
});

describe("CI workflow", () => {
  it("cancels runs that have been replaced by newer ones", () => {
    expect(ci.concurrency["cancel-in-progress"]).toBe(true);
    expect(ci.concurrency.group).toMatch(/github\.workflow/);
    expect(ci.concurrency.group).toMatch(/pull_request\.number|github\.ref/);
  });

  it("installs pnpm from packageManager and caches the pnpm store", () => {
    const steps = ci.jobs.test.steps;
    const names = steps.map((s) => s.uses?.split("@")[0]);
    expect(names.indexOf("pnpm/action-setup")).toBeGreaterThan(-1);
    expect(names.indexOf("pnpm/action-setup")).toBeLessThan(
      names.indexOf("actions/setup-node")
    );
    const node = steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    expect(node.with.cache).toBe("pnpm");
    expect(String(node.with["node-version"])).toBe("22");
    expect(
      steps.find((s) => s.uses?.startsWith("pnpm/action-setup")).with?.version
    ).toBeUndefined();
  });

  it("checks lint, formatting, dependencies and tests", () => {
    const commands = ci.jobs.test.steps.map((s) => s.run).filter(Boolean);
    expect(commands).toEqual(
      expect.arrayContaining([
        "pnpm install --frozen-lockfile",
        "pnpm lint",
        "pnpm format:check",
        "pnpm test",
      ])
    );
    expect(commands.some((c) => /^pnpm audit --prod\b/.test(c))).toBe(true);
  });

  it("builds the image and checks the compose stack end to end", () => {
    const job = ci.jobs.docker;
    expect(job).toBeDefined();
    const commands = job.steps
      .map((s) => s.run)
      .filter(Boolean)
      .join("\n");
    expect(commands).toMatch(/docker compose up .*--build/);
    expect(commands).toContain("scripts/smoke-test.sh");
    expect(commands).toMatch(/docker compose down/);
    // A throwaway secret is made when the job runs; none is written down.
    expect(commands).toMatch(/JWT_SECRET=\$\(openssl rand/);
    const down = job.steps.find((s) => /docker compose down/.test(s.run ?? ""));
    expect(down.if).toBe("always()");
  });
});

describe("CodeQL workflow", () => {
  it("analyses JavaScript on pushes, pull requests and a schedule", () => {
    const events = Object.keys(codeql.on);
    expect(events).toEqual(
      expect.arrayContaining(["push", "pull_request", "schedule"])
    );
    const init = allSteps(codeql).find((s) =>
      s.uses?.includes("codeql-action/init")
    );
    expect(init.with.languages).toBe("javascript-typescript");
    expect(
      allSteps(codeql).some((s) => s.uses?.includes("codeql-action/analyze"))
    ).toBe(true);
  });
});

describe("Dependabot", () => {
  it("watches npm (pnpm), GitHub Actions and Docker every week", () => {
    const byEcosystem = Object.fromEntries(
      dependabot.updates.map((u) => [u["package-ecosystem"], u])
    );
    expect(Object.keys(byEcosystem).sort()).toEqual([
      "docker",
      "github-actions",
      "npm",
    ]);
    for (const update of dependabot.updates) {
      expect(update.schedule.interval).toBe("weekly");
      expect(update["open-pull-requests-limit"]).toBeLessThanOrEqual(10);
      const group = Object.values(update.groups ?? {})[0];
      expect(group["update-types"].sort()).toEqual(["minor", "patch"]);
    }
    expect(byEcosystem.npm.directory).toBe("/");
    expect(byEcosystem.docker.directory).toBe("/");
    expect(byEcosystem["github-actions"].directory).toBe("/");
    expect(dependabot.version).toBe(2);
  });
});

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function run(command, args, env) {
  const child = spawn(command, args, { cwd: root, env });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) =>
    child.on("exit", (code) => resolve({ code, output: () => output }))
  );
  return { child, exited };
}

describe("scripts/smoke-test.sh", () => {
  // Windows has no Unix mode bits, so the executable flag cannot be checked there.
  it.skipIf(process.platform === "win32")("is executable", () => {
    const file = path.join(root, "scripts/smoke-test.sh");
    expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  it("checks readiness, register and login", () => {
    const text = readFileSync(path.join(root, "scripts/smoke-test.sh"), "utf8");
    expect(text).toContain("/readyz");
    expect(text).toContain("/api/v1/auth/register");
    expect(text).toContain("/api/v1/auth/login");
    expect(text).toMatch(/set -euo pipefail/);
  });

  it("has no carriage returns, which would break it under bash", () => {
    const bytes = readFileSync(path.join(root, "scripts/smoke-test.sh"));
    expect(bytes.includes(0x0d)).toBe(false);
  });

  // On Windows, bash may be the WSL one and cannot reach the host's localhost, so this runs on Linux and in CI.
  it.skipIf(process.platform === "win32")(
    "passes against a running server",
    async () => {
      const port = await freePort();
      const server = run(
        process.execPath,
        ["server.js"],
        controlledEnv({
          MONGO_URI: testMongoUri(),
          JWT_SECRET: "test-only-secret-that-is-long-enough-123",
          PORT: String(port),
        })
      );
      try {
        const smoke = run(
          "bash",
          ["scripts/smoke-test.sh", `http://127.0.0.1:${port}`],
          {
            PATH: process.env.PATH,
          }
        );
        const result = await smoke.exited;
        expect(result.output()).toContain("smoke test passed");
        expect(result.code).toBe(0);
      } finally {
        server.child.kill("SIGTERM");
        await server.exited;
        await dropTestDb();
      }
    },
    60000
  );

  // On Windows, bash may be the WSL one and cannot reach the host's localhost, so this runs on Linux and in CI.
  it.skipIf(process.platform === "win32")(
    "fails when nothing is listening",
    async () => {
      const port = await freePort();
      const smoke = run(
        "bash",
        ["scripts/smoke-test.sh", `http://127.0.0.1:${port}`],
        {
          PATH: process.env.PATH,
          SMOKE_TIMEOUT_SECONDS: "3",
        }
      );
      const result = await smoke.exited;
      expect(result.code).not.toBe(0);
      expect(result.output()).toMatch(/not ready/i);
    },
    30000
  );
});
