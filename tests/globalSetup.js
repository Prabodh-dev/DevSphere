import mongoose from "mongoose";

// Test databases are named devsphere_test_<random>. Anything left behind by an
// interrupted run is removed before and after the suite.
const OURS = /^devsphere_test(_[0-9a-f]{8})?$/;

async function removeLeftovers() {
  const uri = process.env.TEST_MONGO_URI;
  if (!uri) return;

  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    const { databases } = await connection.db.admin().listDatabases();
    for (const { name } of databases) {
      if (OURS.test(name)) await connection.useDb(name).dropDatabase();
    }
  } finally {
    await connection.close();
  }
}

export const setup = removeLeftovers;
export const teardown = removeLeftovers;
