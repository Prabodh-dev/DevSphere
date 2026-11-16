import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    globalSetup: ["tests/globalSetup.js"],
    // Every file has its own database, but the files are still run one at a
    // time to keep timing-sensitive socket tests steady.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
