import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

// Every variable documented in .env.example.
const names = readFileSync(path.join(root, ".env.example"), "utf8")
  .split("\n")
  .map((line) => line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)?.[1])
  .filter(Boolean);

// Environment for a child process. Every known variable starts blank, so
// dotenv has nothing to fill in from a local .env file, and the test decides
// what is set.
export function controlledEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    ...Object.fromEntries(names.map((name) => [name, ""])),
    ...overrides,
  };
}
