import { readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const defaultDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);

// Migration files are named like 001-description.js and run in name order.
const MIGRATION_FILE = /^\d+[-_].+\.js$/;

// Runs the migrations that have not been applied yet.
//
// Each file exports `run({ db, dryRun })` and returns `{ changed }`. A step
// must be safe to run twice: the second run changes nothing. On a dry run a
// step reports what it would change and writes nothing. Applied steps are
// recorded in the "migrations" collection.
export async function runMigrations(
  db,
  { dir = defaultDir, dryRun = false } = {}
) {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => MIGRATION_FILE.test(file))
        .sort()
    : [];

  const records = db.collection("migrations");
  const applied = new Set(
    (await records.find({}, { projection: { name: 1 } }).toArray()).map(
      (record) => record.name
    )
  );

  const results = [];
  for (const file of files) {
    const name = file.replace(/\.js$/, "");
    if (applied.has(name)) {
      results.push({ name, status: "skipped", changed: 0 });
      continue;
    }

    const migration = await import(pathToFileURL(path.join(dir, file)).href);
    const { changed = 0 } = (await migration.run({ db, dryRun })) ?? {};

    if (!dryRun) {
      await records.updateOne(
        { name },
        { $setOnInsert: { name, appliedAt: new Date(), changed } },
        { upsert: true }
      );
    }
    results.push({
      name,
      status: dryRun ? "would-apply" : "applied",
      changed,
      description: migration.description,
    });
  }
  return results;
}
