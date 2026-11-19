import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Chat from "../models/Chat.js";
import { startSocketServer, once, sleep } from "./helpers/socket.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/users.js";

let first;
let second;
let alice;
let chat;

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  alice = await createUser();
  chat = await Chat.create({ members: [alice.id] });
  // Two instances sharing one Redis, each allowing 4 events per window.
  const options = { rateLimit: { max: 4, windowMs: 5000 } };
  first = await startSocketServer(options);
  second = await startSocketServer(options);
});

afterAll(async () => {
  await first.close();
  await second.close();
  await disconnectTestDb();
});

describe("socket rate limit across instances", () => {
  it("counts a user's events on every instance together", async () => {
    const onFirst = await first.client(alice);
    const onSecond = await second.client(alice);
    const errors = [];
    onFirst.on("socket-error", (e) => errors.push(e));
    onSecond.on("socket-error", (e) => errors.push(e));

    // Three events here and three there are six in one window. Counted
    // separately, neither instance would see more than its own four.
    for (let i = 0; i < 3; i++) onFirst.emit("typing", chat.id);
    await sleep(300);
    expect(errors).toEqual([]);

    const limited = once(onSecond, "socket-error");
    for (let i = 0; i < 3; i++) onSecond.emit("typing", chat.id);
    expect(await limited).toMatchObject({
      event: "typing",
      error: { code: "RATE_LIMITED" },
    });
  });
});
