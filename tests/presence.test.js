import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "redis";
import { startSocketServer, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/users.js";

let server;
let redis;
let alice;
const isOnline = async (name) => Boolean(await redis.sIsMember(name, alice.id));
const key = () => `${process.env.REDIS_KEY_PREFIX}onlineUsers`;

async function waitFor(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(50);
  }
  return false;
}

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  alice = await createUser();
  redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  server = await startSocketServer();
  // The server connects to Redis in the background.
  await sleep(300);
});

afterAll(async () => {
  await redis.del(key());
  await redis.quit();
  await server.close();
  await disconnectTestDb();
});

describe("online presence", () => {
  it("is kept under this run's key prefix", async () => {
    expect(process.env.REDIS_KEY_PREFIX).toMatch(/^test:[0-9a-f]{8}:$/);

    const socket = await server.client(alice);
    expect(await waitFor(() => isOnline(key()))).toBe(true);
    // Nothing is written to the unprefixed key.
    expect(await isOnline("onlineUsers")).toBe(false);

    socket.close();
    expect(await waitFor(async () => !(await isOnline(key())))).toBe(true);
  });
});
