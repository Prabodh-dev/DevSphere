import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

describe(".gitattributes", () => {
  it("forces LF for scripts, Dockerfile, YAML, migrations and scripts", () => {
    const files = [
      "scripts/smoke-test.sh",
      "Dockerfile",
      ".github/workflows/ci.yml",
      ".github/dependabot.yml",
      "migrations/001-user-timestamps.js",
      "scripts/migrate.js",
      "scripts/make-admin.js",
    ];
    for (const file of files) {
      const out = git("check-attr", "text", "eol", "--", file);
      expect(out, file).toMatch(/eol: lf/);
      expect(out, file).toMatch(/text: set/);
    }
  });

  it("leaves everything else on automatic line endings", () => {
    for (const file of [
      "README.md",
      "app.js",
      "services/authService.js",
      "package.json",
    ]) {
      const out = git("check-attr", "text", "eol", "--", file);
      expect(out, file).toMatch(/text: auto/);
      expect(out, file).toMatch(/eol: unspecified/);
    }
  });

  it("is checked in", () => {
    expect(readFileSync(path.join(root, ".gitattributes"), "utf8")).toMatch(
      /\*\.sh/
    );
    expect(git("ls-files", ".gitattributes").trim()).toBe(".gitattributes");
  });
});

describe("line endings in the repository", () => {
  it("are LF in every tracked text file", () => {
    // i/ is the line ending stored in the repository for each file.
    const crlf = git("ls-files", "--eol")
      .split("\n")
      .filter((line) => /^i\/(crlf|mixed)/.test(line));
    expect(crlf).toEqual([]);
  });
});
