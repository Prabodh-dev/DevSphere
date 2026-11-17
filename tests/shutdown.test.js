import { describe, it, expect, vi } from "vitest";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createShutdown, installProcessGuards } from "../utils/shutdown.js";
import { controlledEnv } from "./helpers/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const silent = { info: vi.fn(), error: vi.fn(), fatal: vi.fn(), warn: vi.fn() };

describe("createShutdown", () => {
  it("closes resources, then exits with the given code", async () => {
    const order = [];
    const exit = vi.fn((code) => order.push(`exit ${code}`));
    const shutdown = createShutdown({
      close: async () => {
        order.push("close");
      },
      exit,
      log: silent,
    });

    await shutdown("SIGTERM");
    expect(order).toEqual(["close", "exit 0"]);

    const failing = vi.fn();
    await createShutdown({ close: async () => {}, exit: failing, log: silent })(
      "unhandledRejection",
      1
    );
    expect(failing).toHaveBeenCalledWith(1);
  });

  it("exits non-zero when closing fails, even for a clean request", async () => {
    const exit = vi.fn();
    await createShutdown({
      close: async () => {
        throw new Error("nope");
      },
      exit,
      log: silent,
    })("SIGTERM", 0);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("runs only once", async () => {
    const close = vi.fn(async () => {});
    const exit = vi.fn();
    const shutdown = createShutdown({ close, exit, log: silent });
    await Promise.all([
      shutdown("SIGTERM"),
      shutdown("SIGINT"),
      shutdown("x", 1),
    ]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout and exits non-zero", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown({
      close: () => new Promise(() => {}),
      timeoutMs: 40,
      exit,
      log: silent,
    });
    shutdown("SIGTERM");
    await new Promise((r) => setTimeout(r, 150));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("installProcessGuards", () => {
  it("shuts down with a failure code on unhandled rejections and uncaught exceptions", () => {
    const handlers = {};
    const proc = { on: (name, fn) => (handlers[name] = fn) };
    const shutdown = vi.fn();
    const log = { ...silent, fatal: vi.fn() };
    installProcessGuards({ shutdown, log, proc });

    const error = new Error("bad");
    handlers.unhandledRejection(error);
    handlers.uncaughtException(error);

    expect(shutdown).toHaveBeenNthCalledWith(1, "unhandledRejection", 1);
    expect(shutdown).toHaveBeenNthCalledWith(2, "uncaughtException", 1);
    expect(log.fatal).toHaveBeenCalledTimes(2);
    expect(log.fatal.mock.calls[0][0]).toMatchObject({ err: error });
  });
});

describe("a real process", () => {
  function run(mode, timeoutMs) {
    const child = spawn(
      process.execPath,
      ["tests/fixtures/crash.js", mode, String(timeoutMs ?? 10000)],
      { cwd: root, env: controlledEnv({ LOG_LEVEL: "info" }) }
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const started = Date.now();
    return new Promise((resolve) =>
      child.on("exit", (code) =>
        resolve({
          code,
          ms: Date.now() - started,
          lines: output
            .trim()
            .split("\n")
            .filter((l) => l.startsWith("{"))
            .map((l) => JSON.parse(l)),
        })
      )
    );
  }

  it("logs, shuts down and exits non-zero after an unhandled rejection", async () => {
    const { code, lines } = await run("reject");
    expect(code).toBe(1);
    const messages = lines.map((l) => l.msg);
    const fatal = lines.find((l) => l.level === "fatal");
    expect(fatal.err.message).toBe("boom from a promise");
    // Resources are closed before the process exits.
    expect(messages).toContain("closing resources");
    expect(messages).toContain("resources closed");
    expect(messages.indexOf("resources closed")).toBeGreaterThan(
      messages.indexOf("unhandledRejection")
    );
  });

  it("does the same after an uncaught exception", async () => {
    const { code, lines } = await run("throw");
    expect(code).toBe(1);
    expect(lines.find((l) => l.level === "fatal").err.message).toBe(
      "boom from a timer"
    );
    expect(lines.map((l) => l.msg)).toContain("resources closed");
  });

  it("still exits non-zero when closing fails", async () => {
    const { code, lines } = await run("reject-failing-close");
    expect(code).toBe(1);
    expect(lines.some((l) => l.level === "error")).toBe(true);
  });

  it("gives up when closing hangs", async () => {
    const { code, ms } = await run("reject-hang", 300);
    expect(code).toBe(1);
    expect(ms).toBeLessThan(5000);
  });

  it("exits cleanly on a signal", async () => {
    const { code, lines } = await run("signal");
    expect(code).toBe(0);
    expect(lines.map((l) => l.msg)).toContain("resources closed");
  });
});

describe("server.js", () => {
  it("installs the process guards", () => {
    const source = readFileSync(path.join(root, "server.js"), "utf8");
    expect(source).toContain("installProcessGuards");
    expect(source).toContain("createShutdown");
  });
});
