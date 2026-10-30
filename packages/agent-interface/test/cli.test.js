import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(packageRoot, "src", "cli.js");

test("help and tools are available without backend access", async () => {
  const help = await runCli(["--help"]);
  assert.match(help.stdout, /koban transactions categorize/);

  const tools = await runCli(["tools"]);
  const payload = JSON.parse(tools.stdout);
  assert.ok(payload.tools.length >= 30);
  assert.ok(payload.tools.some((tool) => tool.name === "koban_modify_transaction_tags"));
});

test("call and doctor use environment configuration without printing the token", async () => {
  const token = "cli-test-token";
  const requests = [];
  await withServer(async (request, response) => {
    requests.push({ authorization: request.headers.authorization, method: request.method, url: request.url });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(request.url === "/api/v1/sync-runs"
      ? { object: "sync_status" }
      : { data: [], object: "list" }));
  }, async (baseUrl) => {
    const env = {
      KOBAN_API_TOKEN: token,
      KOBAN_BASE_URL: baseUrl,
      KOBAN_CONFIG: "none"
    };
    const call = await runCli([
      "call",
      "koban_list_transactions",
      "--json",
      JSON.stringify({ limit: 2 })
    ], env);
    const doctor = await runCli(["doctor"], env);

    assert.deepEqual(JSON.parse(call.stdout), { data: [], object: "list" });
    assert.equal(JSON.parse(doctor.stdout).backend, "reachable");
    assert.doesNotMatch(call.stdout + doctor.stdout + call.stderr + doctor.stderr, /cli-test-token/);
  });

  assert.deepEqual(requests, [
    { authorization: `Bearer ${token}`, method: "GET", url: "/api/v1/transactions?limit=2" },
    { authorization: `Bearer ${token}`, method: "GET", url: "/api/v1/sync-runs" }
  ]);
});

function runCli(args, env = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    timeout: 5_000
  });
}

async function withServer(handler, run) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => response.destroy(error));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
