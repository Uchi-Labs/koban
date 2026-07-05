import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/seed.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3008",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "AI_FINANCES_PGLITE_DIR=tests/e2e/.e2e-data/pglite AI_FINANCES_TELLER_BACKUP_PATH=tests/e2e/.e2e-data/teller-ledger-backup.json AI_FINANCES_IGNORE_WORKSPACE_ENV=1 pnpm dev:e2e --hostname 127.0.0.1 --port 3008",
    url: "http://127.0.0.1:3008",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    }
  ]
});
