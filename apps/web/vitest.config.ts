import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next*/**", "tests/e2e/**"],
    globals: true,
    // PGlite integration tests spin up a fresh embedded Postgres per test; under
    // full-suite parallel load their setup can exceed the 5s default. Give them
    // headroom so timing (not correctness) never flakes the run.
    hookTimeout: 30_000,
    // 16 test files boot a real embedded Postgres (PGlite+pgvector) per test —
    // 85 boots suite-wide. Unbounded fork parallelism (default: CPU count)
    // stampedes those boots past even the 30s timeouts under load. Cap workers
    // so at most a handful of embedded DBs initialize concurrently. (vitest v4
    // uses the top-level maxWorkers/minWorkers; pool already defaults to forks.)
    maxWorkers: 4,
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000
  }
});
