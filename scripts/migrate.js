// Usage: pnpm migrate [--dry-run]
// Applies pending data migrations. Never runs when the server starts.
import { config } from "../config/index.js";
import { cliLogger as log } from "../utils/logger.js";
import mongoose from "mongoose";
import { runMigrations } from "../utils/migrationRunner.js";

const dryRun = process.argv.includes("--dry-run");

if (!config.mongoUri) {
  log.error("MONGO_URI is not set");
  process.exit(1);
}

try {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  if (dryRun) log.info("Dry run: nothing will be written");
  const results = await runMigrations(mongoose.connection.db, { dryRun });

  if (results.length === 0) log.info("No migrations found");
  for (const result of results) {
    const detail =
      result.status === "skipped"
        ? "already applied"
        : `${result.changed} change(s)`;
    log.info(`${result.status.padEnd(11)} ${result.name} (${detail})`);
  }
} catch (err) {
  log.error(`Migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
