import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/agent-interface.spec.ts",
  globalSetup: "./tests/e2e/seed.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3008",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "KOBAN_MAIL_ACCOUNTS_FILE=tests/e2e/.e2e-data/mail-accounts.json AI_FINANCES_PGLITE_DIR=tests/e2e/.e2e-data/pglite AI_FINANCES_LEDGER_BACKUP_PATH=tests/e2e/.e2e-data/ledger-backup.json AI_FINANCES_IGNORE_WORKSPACE_ENV=1 AI_FINANCES_DISABLE_SYNC_TICKER=1 pnpm dev:e2e --hostname 127.0.0.1 --port 3008",
    url: "http://127.0.0.1:3008/manifest.webmanifest",
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
