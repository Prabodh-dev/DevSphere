// Every environment variable the code reads is set here, explicitly. dotenv
// never overrides a variable that is already defined, so a developer's local
// .env cannot change test results. Values are placeholders for tests only.
const defaults = {
  JWT_SECRET: "test-only-secret-that-is-long-enough-123",
  PORT: "",
  MONGO_URI: "",
  CORS_ORIGINS: "",
  TRUST_PROXY: "",

  // The suite makes many requests from one address; keep the limiters out of
  // the way unless a test sets its own values.
  RATE_LIMIT_MAX: "100000",
  AUTH_RATE_LIMIT_MAX: "100000",
  HIGHLIGHT_RATE_LIMIT_MAX: "100000",

  AWS_ACCESS_KEY: "test-access-key-id",
  AWS_SECRET_KEY: "test-secret-access-key",
  AWS_REGION: "eu-west-1",
  AVATAR_BUCKET: "example-bucket",
  MEDIA_URL_TTL_SECONDS: "300",
};

for (const [name, value] of Object.entries(defaults)) {
  process.env[name] = value;
}

// Provided by the environment (CI services or a local shell), with a fallback.
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
