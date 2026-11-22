import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Shared CI runners may also build images: avoid concurrent fsync-heavy suites.
    fileParallelism: !process.env.CI,
    testTimeout: process.env.CI ? 30000 : 5000,
    hookTimeout: process.env.CI ? 60000 : 10000,
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] }
  }
});
