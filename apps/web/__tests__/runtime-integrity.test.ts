// @vitest-environment node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(__dirname, "../../..");

describe("runtime integrity", () => {
  it("does not ship an active fixture package or fixture dependency", () => {
    expect(existsSync(path.join(workspaceRoot, "packages", "fixtures"))).toBe(false);

    const packageJsonPaths = [
      path.join(workspaceRoot, "package.json"),
      path.join(workspaceRoot, "apps", "web", "package.json"),
      path.join(workspaceRoot, "packages", "schema", "package.json"),
      path.join(workspaceRoot, "packages", "sync-protocol", "package.json")
    ];

    for (const packageJsonPath of packageJsonPaths) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(packageJson.dependencies ?? {}).not.toHaveProperty("@ai-finances/fixtures");
      expect(packageJson.devDependencies ?? {}).not.toHaveProperty("@ai-finances/fixtures");
    }
  });

  it("keeps active app runtime free of fixture and SimpleFIN imports", () => {
    const activeSource = readActiveSourceFiles([
      path.join(workspaceRoot, "apps", "web", "app"),
      path.join(workspaceRoot, "apps", "web", "components"),
      path.join(workspaceRoot, "apps", "web", "lib")
    ]).join("\n");

    expect(activeSource).not.toMatch(/@ai-finances\/fixtures/);
    expect(activeSource).not.toMatch(/\bfixture(?:s)?\b/i);
    expect(activeSource).not.toMatch(/\bsimplefin\b/i);
  });

  it("keeps dev, e2e, and production Next artifacts isolated", () => {
    const webPackageJson = JSON.parse(readFileSync(path.join(workspaceRoot, "apps", "web", "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const nextConfig = readFileSync(path.join(workspaceRoot, "apps", "web", "next.config.ts"), "utf8");
    const playwrightConfig = readFileSync(path.join(workspaceRoot, "apps", "web", "playwright.config.ts"), "utf8");
    const gitignore = readFileSync(path.join(workspaceRoot, ".gitignore"), "utf8");

    expect(nextConfig).toContain('process.env.NEXT_DIST_DIR || ".next"');
    expect(webPackageJson.scripts?.build).toContain("NEXT_DIST_DIR=.next-build");
    expect(webPackageJson.scripts?.["dev:e2e"]).toContain("NEXT_DIST_DIR=.next-e2e");
    expect(playwrightConfig).toContain('globalSetup: "./tests/e2e/seed.ts"');
    expect(playwrightConfig).toContain("AI_FINANCES_PGLITE_DIR=tests/e2e/.e2e-data/pglite");
    expect(playwrightConfig).toContain("AI_FINANCES_IGNORE_WORKSPACE_ENV=1");
    expect(playwrightConfig).toContain("pnpm dev:e2e --hostname 127.0.0.1 --port 3008");
    expect(gitignore).toContain(".next-build/");
    expect(gitignore).toContain(".next-e2e/");
    expect(gitignore).toContain("apps/web/tests/e2e/.e2e-data/");
  });
});

function readActiveSourceFiles(roots: string[]): string[] {
  return roots.flatMap((root) => readSourceFiles(root));
}

function readSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const filePath = path.join(root, entry);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      if (entry === "__tests__" || entry === "test-results") {
        return [];
      }

      return readSourceFiles(filePath);
    }

    if (!/\.(ts|tsx)$/.test(entry)) {
      return [];
    }

    return [readFileSync(filePath, "utf8")];
  });
}
