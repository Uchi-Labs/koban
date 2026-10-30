import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps", "web");
const build = path.join(web, ".next-build");
const standalone = path.join(build, "standalone", "apps", "web");
const entry = path.join(standalone, "server.js");

if (!existsSync(entry)) {
  throw new Error("The Koban production build is missing. Run pnpm build first.");
}

// Standalone output omits public/static assets. Copy only those generated or
// public files; credentials and ledger data stay outside the served directory.
for (const [source, destination] of [
  [path.join(build, "static"), path.join(standalone, ".next-build", "static")],
  [path.join(web, "public"), path.join(standalone, "public")]
]) {
  if (existsSync(source)) cpSync(source, destination, { recursive: true });
}

if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
process.env.NODE_ENV = "production";
process.env.HOSTNAME ??= "127.0.0.1";
process.env.PORT ??= "3007";
await import(pathToFileURL(entry).href);
