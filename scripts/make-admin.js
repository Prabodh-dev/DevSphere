// Usage: pnpm make-admin <email>
// Promotes an existing user to the admin role.
import { config } from "../config/index.js";
import mongoose from "mongoose";
import User from "../models/User.js";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error("Usage: pnpm make-admin <email>");
  process.exit(1);
}
if (!config.mongoUri) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}

try {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  const user = await User.findOneAndUpdate(
    { email },
    { role: "admin" },
    { new: true }
  );
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${user.username} is now an admin`);
  }
} catch (err) {
  console.error("Could not update the user:", err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
