import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: [
      // Package CSS side-effect imports (e.g. `@dayflow/blossom-color-picker/styles.css`
      // in components/ui/blossom-picker.tsx) reach the node resolver as real files,
      // which vitest cannot load — the whole suite file fails with
      // `Unknown file extension ".css"`. Styles are irrelevant in jsdom, so map any
      // stylesheet import to an empty module.
      // Anchored at both ends: a bare `/\.css$/` replaces only the matched suffix,
      // turning `@dayflow/blossom-color-picker/styles.css` into
      // `@dayflow/blossom-color-picker/styles<stub-path>`, which then fails as a
      // missing package export. Match the whole specifier so it is fully replaced.
      { find: /^.*\.(css|scss|sass)$/, replacement: new URL("./vitest.style-stub.ts", import.meta.url).pathname },
      { find: "@", replacement: new URL(".", import.meta.url).pathname }
    ]
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next*/**", "**/.claude/**", "tests/e2e/**"],
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
    // Packages that ship side-effect CSS imports must run through vite's transform
    // pipeline; left external, node resolves `…/styles.css` itself and dies with
    // `Unknown file extension ".css"`, taking the whole suite file with it. Inlining
    // lets the stylesheet alias above catch the import.
    server: {
      deps: {
        inline: [/@dayflow[/\\]blossom-color-picker/]
      }
    },
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000
  }
});
