import { describe, it, expect, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  closeRedis,
  createAdapterClients,
  initRedis,
} from "../config/redis.js";
import { withEnv } from "./helpers/config.js";
import { captureLogs } from "./helpers/logs.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function jsFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git"].includes(name)) continue;
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) found.push(...jsFiles(file));
    else if (name.endsWith(".js")) found.push(path.relative(root, file));
  }
  return found;
}

afterAll(closeRedis);

describe("Redis clients", () => {
  it("are created in one place in the app, and for tests in one helper", () => {
    const creators = jsFiles(root).filter((file) =>
      /\bcreateClient\(|\.duplicate\(\)/.test(
        readFileSync(path.join(root, file), "utf8")
      )
    );
    expect(creators.sort()).toEqual(
      ["config/redis.js", "tests/helpers/redis.js"].sort()
    );
  });

  it("all have an error handler, the adapter's subscriber included", () => {
    const shared = initRedis();
    const { raw } = createAdapterClients();
    for (const client of [shared, ...raw]) {
      expect(client.listenerCount("error")).toBeGreaterThan(0);
    }
  });

  it("log a connection error at warn once, without crashing", async () => {
    await closeRedis();
    const logs = captureLogs("trace");
    try {
      await withEnv({ REDIS_URL: "redis://127.0.0.1:1" }, async () => {
        const shared = initRedis();
        const { raw } = createAdapterClients();
        // Errors from every client, repeated.
        for (const client of [shared, ...raw]) {
          client.emit("error", new Error("connection lost"));
          client.emit("error", new Error("connection lost"));
        }
        const warnings = logs.lines.filter(
          (l) => l.level === "warn" && /Redis unavailable/.test(l.msg)
        );
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.length).toBeLessThanOrEqual(3);
        await closeRedis();
      });
    } finally {
      logs.stop();
    }
  });
});
