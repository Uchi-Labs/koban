import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "agent-interface");
const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  console.log("Usage: node scripts/install-koban.mjs [--prefix DIRECTORY]\nDefault prefix: ~/.local. Installs a packaged runtime; requires Node.js and npm, not pnpm.");
  process.exit(0);
}
if (argv.length && (argv.length !== 2 || argv[0] !== "--prefix" || !argv[1])) {
  console.error("Usage: node scripts/install-koban.mjs [--prefix DIRECTORY]");
  process.exit(2);
}
const prefix = path.resolve(argv[1] ?? path.join(os.homedir(), ".local"));
const binary = path.join(prefix, "bin", "koban");
const installedRoot = path.join(prefix, "lib", "node_modules", "@ai-finances", "agent-interface");
const temporary = mkdtempSync(path.join(os.tmpdir(), "koban-install-"));
let previousLauncher;
try {
  const stat = lstatSync(binary, { throwIfNoEntry: false });
  if (stat) {
    const ownedPackageLink = stat.isSymbolicLink() &&
      path.resolve(path.dirname(binary), readlinkSync(binary)) === path.join(installedRoot, "src", "cli.js");
    const previousScript = stat.isFile() ? readFileSync(binary, "utf8") : "";
    const ownedCheckoutLauncher = previousScript.startsWith("#!/bin/sh\nexec ") &&
      previousScript.endsWith(` ${path.join(packageRoot, "src", "cli.js")} "$@"\n`);
    if (!ownedPackageLink && !ownedCheckoutLauncher) {
      throw new Error(`Refusing to overwrite an unrelated executable at ${binary}. Choose another --prefix.`);
    }
    if (ownedCheckoutLauncher) {
      previousLauncher = path.join(temporary, "previous-koban");
      renameSync(binary, previousLauncher);
    }
  }
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], {
    cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"]
  }));
  const archive = path.join(temporary, packed[0].filename);
  const packedFiles = new Set(packed[0].files.map((file) => file.path));
  if (!packedFiles.has("src/cli.js") || !packedFiles.has("src/commands.js")) {
    throw new Error("Koban CLI source is incomplete; wait for the rebuild to finish before installing.");
  }
  execFileSync("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", archive], {
    stdio: "inherit"
  });
  execFileSync(binary, ["--version"], { stdio: "inherit" });
  console.log(`Installed ${binary}\nRun: koban --help\nEnsure ${path.join(prefix, "bin")} is on PATH.`);
} catch (error) {
  if (previousLauncher && existsSync(previousLauncher) && !existsSync(binary)) renameSync(previousLauncher, binary);
  console.error(error instanceof Error ? error.message : "Koban installation failed.");
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
