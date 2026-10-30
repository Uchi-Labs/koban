import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

const namespace = process.env.KOBAN_E2E_NAMESPACE;
if (namespace && !/^[a-z][a-z0-9-]{0,40}$/.test(namespace)) throw new Error("Invalid E2E namespace.");
const port = Number(process.env.KOBAN_E2E_PORT ?? 3008);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid E2E port.");
const baseURL = `http://127.0.0.1:${port}`;

// Run after the UI suite with its own seed/server lifecycle. The MCP workflow
// deliberately adds evidence; UI smoke checks require an empty evidence store.
export default defineConfig({
  ...config,
  ...(namespace ? {
    use: { ...config.use, baseURL },
    outputDir: `test-results-${namespace}`,
    webServer: {
      command: `KOBAN_MAIL_ACCOUNTS_FILE=tests/e2e/.e2e-${namespace}/mail-accounts.json AI_FINANCES_PGLITE_DIR=tests/e2e/.e2e-${namespace}/pglite AI_FINANCES_LEDGER_BACKUP_PATH=tests/e2e/.e2e-${namespace}/ledger-backup.json AI_FINANCES_IGNORE_WORKSPACE_ENV=1 AI_FINANCES_DISABLE_SYNC_TICKER=1 NEXT_DIST_DIR=.next-e2e-${namespace} WATCHPACK_POLLING=true pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
      url: `${baseURL}/manifest.webmanifest`, reuseExistingServer: false, timeout: 120_000
    }
  } : {}),
  testIgnore: [],
  testMatch: "**/agent-interface.spec.ts"
});
