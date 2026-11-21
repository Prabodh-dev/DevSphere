import { randomBytes } from "crypto";
import { beforeAll, afterAll } from "vitest";

// Every environment variable the code reads is set here, explicitly. dotenv
// never overrides a variable that is already defined, so a developer's local
// .env cannot change test results. Values are placeholders for tests only.
const defaults = {
  JWT_SECRET: "test-only-secret-that-is-long-enough-123",
  PORT: "",
  NODE_ENV: "test",
  MONGO_AUTO_INDEX: "true",
  DOCS_ENABLED: "",

  // Tests are quiet unless a test captures logs or LOG_LEVEL is set for the run.
  LOG_LEVEL: process.env.LOG_LEVEL || "silent",
  LOG_PRETTY: "",
  METRICS_ENABLED: "",
  METRICS_TOKEN: "",
  MONGO_URI: "",
  // Origin used by the session tests (refresh and logout check it).
  CORS_ORIGINS: "https://app.example.test",
  TRUST_PROXY: "",
  ACCESS_TOKEN_TTL: "15m",
  REFRESH_TOKEN_TTL_DAYS: "30",
  COOKIE_SECURE: "false",

  // The suite makes many requests from one address; keep the limiters out of
  // the way unless a test sets its own values.
  RATE_LIMIT_MAX: "100000",
  AUTH_RATE_LIMIT_MAX: "100000",
  REFRESH_RATE_LIMIT_MAX: "100000",
  HIGHLIGHT_RATE_LIMIT_MAX: "100000",

  AWS_ACCESS_KEY: "test-access-key-id",
  AWS_SECRET_KEY: "test-secret-access-key",
  AWS_REGION: "eu-west-1",
  AVATAR_BUCKET: "example-bucket",
  MEDIA_URL_TTL_SECONDS: "300",
  // Live code edits are saved this long after the last one.
  LIVE_CODE_FLUSH_MS: "200",
};

// Each test file gets its own database and Redis key prefix, so files never
// see each other's documents, indexes or keys.
const suffix = randomBytes(4).toString("hex");
defaults.TEST_DB_NAME = `devsphere_test_${suffix}`;
defaults.REDIS_KEY_PREFIX = `test:${suffix}:`;

for (const [name, value] of Object.entries(defaults)) {
  process.env[name] = value;
}

// Provided by the environment (CI services or a local shell), with a fallback.
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// A test file must leave nothing behind for the next one. Workers can be
// reused (and are with --no-isolate), so a Redis client or an environment
// variable left over from one file changes the results of another.
const suiteEnv = { ...process.env };
const CONTROLLED = ["REDIS_URL", "REDIS_KEY_PREFIX", "TEST_DB_NAME"];

// Mongoose warns (once per process) about options it is going to remove. The
// suite must stay free of them, so they fail the file that triggers them.
const mongooseWarnings = [];
const onWarning = (warning) => {
  if (/mongoose/i.test(`${warning.name} ${warning.message}`)) {
    mongooseWarnings.push(warning.message);
  }
};
process.on("warning", onWarning);

beforeAll(async () => {
  // `config` is read once per module load; point it at this file's settings.
  const { reloadConfig } = await import("../config/index.js");
  reloadConfig();
});

afterAll(async () => {
  // Warnings are delivered a moment after they are raised.
  await new Promise((resolve) => setImmediate(resolve));
  process.off("warning", onWarning);
  if (mongooseWarnings.length) {
    throw new Error(`Mongoose warned: ${mongooseWarnings[0]}`);
  }

  const { closeRedis } = await import("../config/redis.js");
  await closeRedis();

  const changed = CONTROLLED.filter(
    (name) => process.env[name] !== suiteEnv[name]
  );
  for (const name of changed) process.env[name] = suiteEnv[name];
  if (changed.length) {
    throw new Error(
      `${changed.join(", ")} was changed and not put back by this test file`
    );
  }
});
