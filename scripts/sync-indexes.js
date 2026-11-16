// Usage: pnpm db:indexes [--dry-run]
// Makes the database indexes match the models: creates missing ones and drops
// ones the models no longer declare.
import "dotenv/config";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import mongoose from "mongoose";

// Loading the models must not build indexes as a side effect.
process.env.MONGO_AUTO_INDEX = "false";

const dryRun = process.argv.includes("--dry-run");
const modelsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../models"
);

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  for (const file of readdirSync(modelsDir).filter((f) => f.endsWith(".js"))) {
    await import(pathToFileURL(path.join(modelsDir, file)).href);
  }

  if (dryRun) console.log("Dry run: no indexes will be changed");

  for (const name of mongoose.modelNames().sort()) {
    const Model = mongoose.model(name);
    const label = Model.collection.collectionName;

    if (dryRun) {
      const diff = await Model.diffIndexes();
      const show = (list) => list.map((i) => JSON.stringify(i)).join(", ");
      console.log(
        `${label}: would create [${show(diff.toCreate)}], drop [${show(diff.toDrop)}]`
      );
    } else {
      const dropped = await Model.syncIndexes();
      console.log(
        `${label}: ok${dropped.length ? `, dropped [${dropped.join(", ")}]` : ""}`
      );
    }
  }
} catch (err) {
  console.error("Could not sync indexes:", err.message);
  if (err.code === 11000 || /duplicate key/i.test(err.message)) {
    console.error(
      "Existing data conflicts with a unique index. Run `pnpm migrate` first, then try again."
    );
  }
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
