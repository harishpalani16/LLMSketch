import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // OCCT wasm init is ~10 s cold; kernel suites need room.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: "forks",
    // one OCCT instance per run: init is expensive
    fileParallelism: false,
  },
});
