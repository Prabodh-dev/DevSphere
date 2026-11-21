import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// CI installs with --frozen-lockfile, which fails when package.json and
// pnpm-lock.yaml disagree about a dependency.
describe("pnpm-lock.yaml", () => {
  it("records the same dependencies and version ranges as package.json", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = parse(read("pnpm-lock.yaml"));
    const importer = lock.importers["."];

    for (const group of ["dependencies", "devDependencies"]) {
      const wanted = pkg[group] ?? {};
      const locked = Object.fromEntries(
        Object.entries(importer[group] ?? {}).map(([name, info]) => [
          name,
          info.specifier,
        ])
      );
      expect(locked, `${group} in pnpm-lock.yaml`).toEqual(wanted);
    }
  });
});
