import { describe, it, expect } from "vitest";

// A local .env must not change test results, so the setup file sets every
// variable the tests rely on.
describe("test environment", () => {
  it("uses the values from tests/setup.js", () => {
    expect(process.env.AWS_REGION).toBe("eu-west-1");
    expect(process.env.AWS_ACCESS_KEY).toBe("test-access-key-id");
    expect(process.env.AWS_SECRET_KEY).toBe("test-secret-access-key");
    expect(process.env.AVATAR_BUCKET).toBe("example-bucket");
    expect(process.env.MONGO_URI).toBe("");
    expect(process.env.CORS_ORIGINS).toBe("https://app.example.test");
    expect(process.env.ACCESS_TOKEN_TTL).toBe("15m");
    expect(process.env.COOKIE_SECURE).toBe("false");
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.MONGO_AUTO_INDEX).toBe("true");
  });
});

describe("per-file isolation", () => {
  it("gives each test file its own database name and Redis prefix", () => {
    expect(process.env.TEST_DB_NAME).toMatch(/^devsphere_test_[0-9a-f]{8}$/);
    expect(process.env.REDIS_KEY_PREFIX).toBe(
      `test:${process.env.TEST_DB_NAME.slice("devsphere_test_".length)}:`
    );
  });
});
