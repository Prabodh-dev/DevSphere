import mongoose from "mongoose";

// Every test file works in its own database (see tests/setup.js).
export const testDbName = () => process.env.TEST_DB_NAME;

function baseUri() {
  const uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    throw new Error(
      "TEST_MONGO_URI is not set. Point it at a throwaway MongoDB, e.g. mongodb://127.0.0.1:27017"
    );
  }
  return uri;
}

// The test database's address, for code that connects on its own (child
// processes). Any options in TEST_MONGO_URI are kept.
export function testMongoUri() {
  const url = new URL(baseUri());
  url.pathname = `/${testDbName()}`;
  return url.toString();
}

export async function connectTestDb() {
  await mongoose.connect(baseUri(), { dbName: testDbName() });
}

export async function clearTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

// Removes every index except _id, so a test that inserts old-style data does
// not depend on which models were loaded before it.
export async function dropAllIndexes() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.dropIndexes().catch(() => {})));
}

export async function disconnectTestDb() {
  // Index builds started by the models can still be running. Let them finish,
  // or they could recreate the database after it was dropped.
  await Promise.allSettled(
    mongoose.modelNames().map((name) => mongoose.model(name).init())
  );
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

// For files that use the database only through child processes.
export async function dropTestDb() {
  const connection = await mongoose
    .createConnection(baseUri(), { dbName: testDbName() })
    .asPromise();
  try {
    await connection.dropDatabase();
  } finally {
    await connection.close();
  }
}
