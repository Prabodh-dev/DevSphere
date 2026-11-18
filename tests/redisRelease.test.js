import { describe, it, expect, afterAll } from "vitest";
import { closeRedis, initRedis } from "../config/redis.js";
import { startSocketServer } from "./helpers/socket.js";

afterAll(closeRedis);

// Files can share a worker, so Redis state must not outlive the test that
// created it.
describe("Redis between test files", () => {
  it("is released when a socket test server is closed", async () => {
    const server = await startSocketServer();
    // Already started by the socket server, so this returns that client.
    const started = initRedis();
    expect(started).not.toBeNull();

    await server.close();

    const next = initRedis();
    expect(next).not.toBe(started);
    await closeRedis();
  });
});
