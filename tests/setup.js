// Placeholder values for the test process only. Real deployments use their own env.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-that-is-long-enough-123";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// The suite makes many requests from one address; keep the limiters out of the way
// unless a test sets its own values.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || "100000";
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || "100000";
process.env.HIGHLIGHT_RATE_LIMIT_MAX =
  process.env.HIGHLIGHT_RATE_LIMIT_MAX || "100000";
