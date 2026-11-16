import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");

describe("README", () => {
  it("documents every variable listed in .env.example", () => {
    const names = read(".env.example")
      .split("\n")
      .map((line) => line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean);
    const readme = read("README.md");

    const missing = names.filter((name) => !readme.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it("describes the auth endpoints", () => {
    const readme = read("README.md");
    for (const endpoint of [
      "/api/auth/refresh",
      "/api/auth/logout",
      "/api/auth/logout-all",
      "/api/auth/sessions",
      "/api/auth/change-password",
    ]) {
      expect(readme).toContain(endpoint);
    }
    expect(readme).toContain("sequenceDiagram");
  });
});
