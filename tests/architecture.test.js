import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const jsFiles = (dir) =>
  readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `${dir}/${name}`);

// The modules a file imports, as written in its import statements.
const importsOf = (file) =>
  [...read(file).matchAll(/^import[^;]*?from\s+"([^"]+)";/gms)].map(
    (m) => m[1]
  );

const offenders = (dir, forbidden) =>
  jsFiles(dir).flatMap((file) =>
    importsOf(file)
      .filter((specifier) => forbidden.test(specifier))
      .map((specifier) => `${file} imports ${specifier}`)
  );

describe("layers", () => {
  it("keep controllers free of models and the database driver", () => {
    expect(offenders("controllers", /models\/|^mongoose$/)).toEqual([]);
  });

  it("keep routes free of models", () => {
    expect(offenders("routes", /models\//)).toEqual([]);
  });

  it("let services depend on models and utilities only", () => {
    expect(
      offenders("services", /controllers\/|routes\/|middlewares\/|^express$/)
    ).toEqual([]);
  });

  it("keep utilities independent of services, controllers and routes", () => {
    expect(
      offenders("utils", /services\/|controllers\/|routes\/|middlewares\//)
    ).toEqual([]);
  });

  it("keep models independent of everything above them", () => {
    expect(
      offenders(
        "models",
        /services\/|controllers\/|routes\/|middlewares\/|utils\//
      )
    ).toEqual([]);
  });

  it("give every controller and service a name that matches its content", () => {
    const controllers = jsFiles("controllers").map((f) => path.basename(f));
    const services = jsFiles("services").map((f) => path.basename(f));
    expect(controllers).toEqual(
      expect.arrayContaining(["chatController.js", "groupController.js"])
    );
    expect(services).toEqual(
      expect.arrayContaining([
        "chatService.js",
        "groupService.js",
        "authService.js",
      ])
    );
    // The chat controller holds chat logic and the group controller group logic.
    expect(read("controllers/groupController.js")).toMatch(/groups\./);
    expect(read("controllers/chatController.js")).not.toMatch(/groups\./);
  });
});

describe("docs/architecture.md", () => {
  const doc = read("docs/architecture.md");

  it("has a diagram of the layers", () => {
    expect(doc).toContain("```mermaid");
    for (const layer of [
      "Routes",
      "Validation",
      "Controllers",
      "Services",
      "Models",
      "Sockets",
    ]) {
      expect(doc, layer).toContain(layer);
    }
  });

  it("describes the request flow", () => {
    expect(doc).toContain("sequenceDiagram");
    for (const step of [
      "requestId",
      "requestLogger",
      "validate",
      "errorHandler",
    ]) {
      expect(doc, step).toContain(step);
    }
  });

  it("only mentions folders and files that exist", () => {
    const mentioned = [
      ...doc.matchAll(/`((?:[\w-]+\/)+[\w.-]+\.js|[\w-]+\/)`/g),
    ].map((m) => m[1]);
    expect(mentioned.length).toBeGreaterThan(5);
    for (const entry of mentioned) {
      expect(existsSync(path.join(root, entry)), entry).toBe(true);
    }
  });
});
