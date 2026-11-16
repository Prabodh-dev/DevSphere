import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", "tests", ".git", "coverage"]);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

describe(".env.example", () => {
  it("lists every environment variable the code reads", () => {
    const used = new Set();
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        used.add(match[1]);
      }
      for (const match of text.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)) {
        used.add(match[1]);
      }
    }

    const documented = new Set(
      readFileSync(path.join(root, ".env.example"), "utf8")
        .split("\n")
        .map((line) => line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
        .filter(Boolean)
    );

    const missing = [...used].filter((name) => !documented.has(name));
    expect(missing).toEqual([]);
  });

  it("contains placeholders only", () => {
    const text = readFileSync(path.join(root, ".env.example"), "utf8");
    expect(text).not.toMatch(/AKIA[0-9A-Z]{12,}/);
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\/[^\s]*:[^\s@]+@/);
  });
});
