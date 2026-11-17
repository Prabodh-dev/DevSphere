import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ENV_VARIABLES } from "../config/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe(".env.example", () => {
  it("lists every environment variable the config module reads", () => {
    const documented = new Set(
      readFileSync(path.join(root, ".env.example"), "utf8")
        .split("\n")
        .map((line) => line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
        .filter(Boolean)
    );

    const missing = ENV_VARIABLES.filter((name) => !documented.has(name));
    expect(missing).toEqual([]);
  });

  it("lists nothing the app does not read", () => {
    const documented = readFileSync(path.join(root, ".env.example"), "utf8")
      .split("\n")
      .map((line) => line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean);
    expect(documented.filter((name) => !ENV_VARIABLES.includes(name))).toEqual(
      []
    );
  });

  it("contains placeholders only", () => {
    const text = readFileSync(path.join(root, ".env.example"), "utf8");
    expect(text).not.toMatch(/AKIA[0-9A-Z]{12,}/);
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\/[^\s]*:[^\s@]+@/);
  });
});
