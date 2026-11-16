// Usage: pnpm migrate [--dry-run]
// Applies pending data migrations. Never runs when the server starts.
import "dotenv/config";
import mongoose from "mongoose";
import { runMigrations } from "../utils/migrationRunner.js";

const dryRun = process.argv.includes("--dry-run");

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });

  if (dryRun) console.log("Dry run: nothing will be written");
  const results = await runMigrations(mongoose.connection.db, { dryRun });

  if (results.length === 0) console.log("No migrations found");
  for (const result of results) {
    const detail =
      result.status === "skipped"
        ? "already applied"
        : `${result.changed} change(s)`;
    console.log(`${result.status.padEnd(11)} ${result.name} (${detail})`);
  }
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
