import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

let workspaceEnvWriteQueue = Promise.resolve();

function getWorkspaceEnvPath(): string {
  return path.join(findWorkspaceRoot(), ".env");
}

export function readWorkspaceEnv(): WorkspaceEnv {
  const envPath = getWorkspaceEnvPath();
  const fileEnv =
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV === "1"
      ? {}
      : existsSync(envPath)
        ? parseEnvFile(readFileSync(envPath, "utf8"))
        : {};

  return {
    ...compactProcessEnv(process.env),
    ...fileEnv
  };
}

export function upsertWorkspaceEnv(updates: WorkspaceEnv): Promise<void> {
  const write = workspaceEnvWriteQueue.then(() => upsertWorkspaceEnvNow(updates));
  workspaceEnvWriteQueue = write.catch(() => undefined);
  return write;
}

export function deleteWorkspaceEnv(keys: string[]): Promise<void> {
  const write = workspaceEnvWriteQueue.then(() => deleteWorkspaceEnvNow(keys));
  workspaceEnvWriteQueue = write.catch(() => undefined);
  return write;
}

function upsertWorkspaceEnvNow(updates: WorkspaceEnv): void {
  const envPath = getWorkspaceEnvPath();
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const handledKeys = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);

    if (!match) {
      return line;
    }

    const key = match[1];

    if (!(key in updates)) {
      return line;
    }

    handledKeys.add(key);
    return `${key}=${formatEnvValue(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!handledKeys.has(key)) {
      nextLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  const envDirectory = path.dirname(envPath);
  const tmpPath = path.join(envDirectory, `.env.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  mkdirSync(envDirectory, { recursive: true });

  try {
    writeFileSync(tmpPath, `${trimTrailingBlankLines(nextLines).join("\n")}\n`, { mode: 0o600 });
    renameSync(tmpPath, envPath);
    chmodSync(envPath, 0o600);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Best effort cleanup; preserve the original write error.
    }

    throw error;
  }
}

function deleteWorkspaceEnvNow(keys: string[]): void {
  const envPath = getWorkspaceEnvPath();

  if (!existsSync(envPath)) {
    return;
  }

  const keysToDelete = new Set(keys);
  const existing = readFileSync(envPath, "utf8");
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const nextLines = lines.filter((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    return !match || !keysToDelete.has(match[1]);
  });

  const envDirectory = path.dirname(envPath);
  const tmpPath = path.join(envDirectory, `.env.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  try {
    writeFileSync(tmpPath, `${trimTrailingBlankLines(nextLines).join("\n")}\n`, { mode: 0o600 });
    renameSync(tmpPath, envPath);
    chmodSync(envPath, 0o600);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Best effort cleanup; preserve the original write error.
    }

    throw error;
  }
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

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+=-]*$/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const nextLines = [...lines];

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  return nextLines;
}
