// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceEnv, upsertWorkspaceEnv } from "@/lib/workspace-env";

let testRoot: string | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = null;
  }
  delete process.env.AI_FINANCES_PROCESS_ONLY_TEST;
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
});

describe("workspace env writes", () => {
  it("serializes concurrent upserts and writes .env atomically with private mode", async () => {
    testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-env-"));
    writeFileSync(path.join(testRoot, "pnpm-workspace.yaml"), "packages: []\n");
    vi.spyOn(process, "cwd").mockReturnValue(testRoot);
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "0";

    await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        await upsertWorkspaceEnv({
          [`AI_FINANCES_TEST_KEY_${index}`]: `value ${index}`
        });
      })
    );

    const envPath = path.join(testRoot, ".env");
    const envSource = readFileSync(envPath, "utf8");
    const env = readWorkspaceEnv();

    for (let index = 0; index < 10; index += 1) {
      expect(env[`AI_FINANCES_TEST_KEY_${index}`]).toBe(`value ${index}`);
      expect(envSource).toContain(`AI_FINANCES_TEST_KEY_${index}="value ${index}"`);
    }

    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it("keeps process env values when no workspace .env file exists", () => {
    testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-env-"));
    writeFileSync(path.join(testRoot, "pnpm-workspace.yaml"), "packages: []\n");
    vi.spyOn(process, "cwd").mockReturnValue(testRoot);
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "0";
    process.env.AI_FINANCES_PROCESS_ONLY_TEST = "from-process";

    expect(readWorkspaceEnv().AI_FINANCES_PROCESS_ONLY_TEST).toBe("from-process");
  });
});
