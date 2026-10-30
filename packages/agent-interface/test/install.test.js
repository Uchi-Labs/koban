import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPackageFiles = [
  "README.md",
  "package.json",
  "src/catalog.js",
  "src/cli.js",
  "src/client.js",
  "src/commands.js",
  "src/connectors.js",
  "src/mail-accounts.js",
  "src/mcp.js",
  "src/shop-session.js"
];

test("npm package contains only the standalone runtime contract", async () => {
  const { stdout } = await execFileAsync("npm", [
    "pack",
    "--dry-run",
    "--json",
    "--ignore-scripts"
  ], {
    cwd: packageRoot,
    env: isolatedEnvironment()
  });
  const result = JSON.parse(stdout);
  assert.equal(result.length, 1);
  const files = result[0].files.map(({ path: filePath }) => filePath).sort();

  assert.deepEqual(files, expectedPackageFiles);
  assert.ok(files.every((filePath) => !filePath.includes("test")));
  assert.ok(files.every((filePath) => !/(?:^|\/)(?:\.env|config\.json)$/u.test(filePath)));
});

test("packed CLI installs globally and runs outside the checkout without pnpm", {
  skip: process.env.KOBAN_TEST_INSTALL !== "1"
}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "koban-package-install-"));
  const packDirectory = path.join(temporary, "pack");
  const prefix = path.join(temporary, "prefix");
  const externalCwd = path.join(temporary, "outside-checkout");

  try {
    await Promise.all([
      mkdir(packDirectory, { recursive: true }),
      mkdir(externalCwd, { recursive: true })
    ]);
    const packed = await execFileAsync("npm", [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDirectory
    ], { cwd: packageRoot, env: isolatedEnvironment() });
    const archiveName = JSON.parse(packed.stdout)[0].filename;
    const archive = path.join(packDirectory, archiveName);

    await execFileAsync("npm", [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive
    ], { cwd: externalCwd, env: isolatedEnvironment() });

    const binary = path.join(prefix, "bin", "koban");
    await access(binary);
    const runtimeEnv = isolatedEnvironment({
      KOBAN_BASE_URL: "http://127.0.0.1:1",
      KOBAN_CONFIG: "none",
      PATH: [path.join(prefix, "bin"), path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter)
    });
    const help = await execFileAsync(binary, ["--help"], { cwd: externalCwd, env: runtimeEnv });
    const version = await execFileAsync(binary, ["--version"], { cwd: externalCwd, env: runtimeEnv });
    const tools = await execFileAsync(binary, ["tools", "--json"], { cwd: externalCwd, env: runtimeEnv });

    assert.match(help.stdout, /Usage:/u);
    assert.match(version.stdout.trim(), /^koban \d+\.\d+\.\d+$/u);
    const toolPayload = JSON.parse(tools.stdout);
    assert.ok(Array.isArray(toolPayload.tools));
    assert.ok(toolPayload.tools.length >= 30);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

function isolatedEnvironment(overrides = {}) {
  return {
    HOME: os.homedir(),
    LANG: process.env.LANG ?? "C",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...overrides
  };
}
