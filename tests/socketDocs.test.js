import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// Built-in Socket.IO events are not part of the API.
const BUILT_IN = new Set([
  "connect",
  "connection",
  "disconnect",
  "connect_error",
]);

// Events the server listens for: on("name", ...) in socket.js.
function handledEvents() {
  const source = read("socket.js");
  return [...source.matchAll(/\bon\(\s*"([\w-]+)"/g)]
    .map((m) => m[1])
    .filter((name) => !BUILT_IN.has(name));
}

// Events the server sends: .emit("name", ...) in the socket code and the
// services that push to sockets.
const EMITTING_FILES = [
  "socket.js",
  "services/notificationService.js",
  "services/chatService.js",
];

function emittedEvents() {
  const source = EMITTING_FILES.map(read).join("\n");
  return [...source.matchAll(/\.emit\(\s*"([\w-]+)"/g)]
    .map((m) => m[1])
    .filter((name) => !BUILT_IN.has(name));
}

// Event names listed in the first column of a table under a heading.
function documented(heading) {
  const doc = read("docs/socket-events.md");
  const start = doc.indexOf(`## ${heading}`);
  expect(start, `missing section "${heading}"`).toBeGreaterThan(-1);
  const rest = doc.slice(start + heading.length + 3);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| `([\w-]+)`\s*\|/gm)].map((m) => m[1]);
}

const sorted = (list) => [...new Set(list)].sort();

describe("docs/socket-events.md", () => {
  it("lists exactly the events the server handles", () => {
    const code = sorted(handledEvents());
    expect(code.length).toBeGreaterThan(5);
    expect(sorted(documented("Client to server"))).toEqual(code);
  });

  it("lists exactly the events the server sends", () => {
    const code = sorted(emittedEvents());
    expect(code.length).toBeGreaterThan(5);
    expect(sorted(documented("Server to client"))).toEqual(code);
  });

  it("does not list an event twice", () => {
    for (const heading of ["Client to server", "Server to client"]) {
      const names = documented(heading);
      expect(names.length).toBe(new Set(names).size);
    }
  });

  it("explains the handshake, limits and the error event", () => {
    const doc = read("docs/socket-events.md");
    for (const text of [
      "auth",
      "token",
      "Authentication failed",
      "socket-error",
      "RATE_LIMITED",
      "512 KB",
      "5000",
      "100000",
      "acknowledgement",
    ]) {
      expect(doc, text).toContain(text);
    }
  });

  it("states the same limits as the code", () => {
    const socket = read("socket.js");
    const schema = read("schemas/socket.js");
    expect(socket).toMatch(/MAX_PACKET_BYTES = 512 \* 1024/);
    expect(schema).toMatch(/code: z\.string\(\)\.max\(100000\)/);
    expect(socket).toMatch(/max: 100, windowMs: 10 \* 1000/);
  });
});
