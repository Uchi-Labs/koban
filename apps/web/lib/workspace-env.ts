import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type WorkspaceEnv = Record<string, string>;

export function findWorkspaceRoot(startDirectory = process.cwd()): string {
  let currentDirectory = startDirectory;

  while (currentDirectory !== path.dirname(currentDirectory)) {
    if (existsSync(path.join(currentDirectory, "pnpm-workspace.yaml"))) {
      return currentDirectory;
    }

    currentDirectory = path.dirname(currentDirectory);
  }

  return startDirectory;
}

function getWorkspaceEnvPath(): string {
  return path.join(findWorkspaceRoot(), ".env");
}

// Parsed once per path: this runs on every proxied request (system-design F15).
// Nothing in the app writes .env at runtime, so a restart picks up edits.
const workspaceEnvFileCache = new Map<string, WorkspaceEnv>();
const warnedConflictKeys = new Set<string>();

/**
 * Shell environment first, the workspace `.env` as a fallback. A key set in
 * both with different values keeps the shell value and logs one warning per
 * key (names only, never values).
 */
export function readWorkspaceEnv(): WorkspaceEnv {
  const processEnv = compactProcessEnv(process.env);
  const fileEnv = process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV === "1" ? {} : readWorkspaceEnvFile(getWorkspaceEnvPath());

  for (const [key, value] of Object.entries(fileEnv)) {
    if (key in processEnv && processEnv[key] !== value && !warnedConflictKeys.has(key)) {
      warnedConflictKeys.add(key);
      console.warn(`[config] ${key} is set in both the shell and .env with different values; using the shell value.`);
    }
  }

  return {
    ...fileEnv,
    ...processEnv
  };
}

function readWorkspaceEnvFile(envPath: string): WorkspaceEnv {
  const cached = workspaceEnvFileCache.get(envPath);
  if (cached) return cached;
  const parsed = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
  workspaceEnvFileCache.set(envPath, parsed);
  return parsed;
}

function compactProcessEnv(env: NodeJS.ProcessEnv): WorkspaceEnv {
  const result: WorkspaceEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}

function parseEnvFile(source: string): WorkspaceEnv {
  const result: WorkspaceEnv = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      result[key] = parseEnvValue(rawValue);
    }
  }

  return result;
}

function parseEnvValue(rawValue: string): string {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }

  const commentIndex = rawValue.indexOf(" #");
  return commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex).trim();
}
