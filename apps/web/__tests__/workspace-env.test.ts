// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceEnv } from "@/lib/workspace-env";

let testRoot: string | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = null;
  }
  delete process.env.AI_FINANCES_PROCESS_ONLY_TEST;
  delete process.env.AI_FINANCES_PRECEDENCE_TEST;
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
});

function useWorkspace(envFile?: string): string {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-env-"));
  writeFileSync(path.join(testRoot, "pnpm-workspace.yaml"), "packages: []\n");
  if (envFile !== undefined) writeFileSync(path.join(testRoot, ".env"), envFile);
  vi.spyOn(process, "cwd").mockReturnValue(testRoot);
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "0";
  return testRoot;
}

describe("workspace env", () => {
  it("keeps process env values when no workspace .env file exists", () => {
    useWorkspace();
    process.env.AI_FINANCES_PROCESS_ONLY_TEST = "from-process";

    expect(readWorkspaceEnv().AI_FINANCES_PROCESS_ONLY_TEST).toBe("from-process");
  });

  it("uses .env values the shell does not set", () => {
    useWorkspace('AI_FINANCES_FILE_ONLY_TEST="from file"\n');

    expect(readWorkspaceEnv().AI_FINANCES_FILE_ONLY_TEST).toBe("from file");
  });

  it("prefers the shell over .env and warns once per conflicting key without printing values", () => {
    useWorkspace("AI_FINANCES_PRECEDENCE_TEST=file-secret\n");
    process.env.AI_FINANCES_PRECEDENCE_TEST = "shell-secret";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(readWorkspaceEnv().AI_FINANCES_PRECEDENCE_TEST).toBe("shell-secret");
    expect(readWorkspaceEnv().AI_FINANCES_PRECEDENCE_TEST).toBe("shell-secret");

    const conflictWarnings = warn.mock.calls.filter(([message]) => String(message).includes("AI_FINANCES_PRECEDENCE_TEST"));
    expect(conflictWarnings).toHaveLength(1);
    expect(String(conflictWarnings[0][0])).not.toContain("secret");
  });

  it("reads the .env file once per process", () => {
    const root = useWorkspace("AI_FINANCES_CACHED_TEST=first\n");

    expect(readWorkspaceEnv().AI_FINANCES_CACHED_TEST).toBe("first");
    writeFileSync(path.join(root, ".env"), "AI_FINANCES_CACHED_TEST=second\n");
    expect(readWorkspaceEnv().AI_FINANCES_CACHED_TEST).toBe("first");
  });
});
