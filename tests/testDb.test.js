import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import LiveCode from "../models/LiveCode.js";
import Follow from "../models/Follow.js";
import {
  connectTestDb,
  disconnectTestDb,
  testDbName,
  testMongoUri,
} from "./helpers/db.js";

async function databaseNames() {
  const admin = await mongoose
    .createConnection(process.env.TEST_MONGO_URI)
    .asPromise();
  try {
    const { databases } = await admin.db.admin().listDatabases();
    return databases.map((d) => d.name);
  } finally {
    await admin.close();
  }
}

describe("test database", () => {
  it("is private to this test file", async () => {
    expect(testDbName()).toMatch(/^devsphere_test_[0-9a-f]{8}$/);
    expect(new URL(testMongoUri()).pathname).toBe(`/${testDbName()}`);

    await connectTestDb();
    expect(mongoose.connection.name).toBe(testDbName());
    await disconnectTestDb();
  });

  it("is gone after the file, even when indexes were still being built", async () => {
    await connectTestDb();
    // Start building unique indexes and tear down straight away.
    LiveCode.init();
    Follow.init();
    await mongoose.connection.db
      .collection("livecodes")
      .insertOne({ chatId: 1 });
    await disconnectTestDb();

    // Give a late index build the chance to recreate the database.
    await new Promise((r) => setTimeout(r, 500));
    expect(await databaseNames()).not.toContain(testDbName());
  });
});
