import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectTestDb, clearTestDb, disconnectTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/users.js";
import { updateTags } from "../services/userService.js";
import { saveProfile } from "../services/profileService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", "tests"]);

function sources(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) found.push(...sources(file));
    else if (name.endsWith(".js")) found.push(file);
  }
  return found;
}

describe("Mongoose options", () => {
  it("do not use the deprecated `new` option", () => {
    const offenders = sources(root).filter((file) =>
      /\bnew:\s*true\b/.test(readFileSync(file, "utf8"))
    );
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  describe("updates that return the new document", () => {
    beforeAll(connectTestDb);
    afterAll(disconnectTestDb);

    it("raise no Mongoose warning and still return the updated document", async () => {
      await clearTestDb();
      const warnings = [];
      const onWarning = (w) => warnings.push(`${w.name} ${w.message}`);
      process.on("warning", onWarning);
      try {
        const user = await createUser();
        expect(await updateTags(user.id, ["node", "js"])).toEqual([
          "node",
          "js",
        ]);
        const saved = await saveProfile(
          { _id: user.id, username: user.username },
          { bio: "hello" }
        );
        expect(saved.profile.bio).toBe("hello");
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("warning", onWarning);
      }
      expect(warnings.filter((w) => /mongoose/i.test(w))).toEqual([]);
    });
  });
});
