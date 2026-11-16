import mongoose from "mongoose";

export async function connectTestDb() {
  const uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    throw new Error(
      "TEST_MONGO_URI is not set. Point it at a throwaway MongoDB, e.g. mongodb://127.0.0.1:27017"
    );
  }
  await mongoose.connect(uri, { dbName: "devsphere_test" });
}

export async function clearTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
