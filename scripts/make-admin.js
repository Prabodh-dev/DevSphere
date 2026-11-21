// Usage: pnpm make-admin <email>
// Promotes an existing user to the admin role.
import { config } from "../config/index.js";
import { cliLogger as log } from "../utils/logger.js";
import mongoose from "mongoose";
import User from "../models/User.js";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  log.error("Usage: pnpm make-admin <email>");
  process.exit(1);
}
if (!config.mongoUri) {
  log.error("MONGO_URI is not set");
  process.exit(1);
}

try {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  const user = await User.findOneAndUpdate(
    { email },
    { role: "admin" },
    { returnDocument: "after" }
  );
  if (!user) {
    log.error(`User not found: ${email}`);
    process.exitCode = 1;
  } else {
    log.info(`${user.username} is now an admin`);
  }
} catch (err) {
  log.error(`Could not update the user: ${err.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
