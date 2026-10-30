import assert from "node:assert/strict";
import test from "node:test";
import { connectorDefinitions, inspectConnector, resolveConnector, setupConnector } from "../src/connectors.js";

test("exports a closed connector allowlist with supported aliases", () => {
  assert.deepEqual(connectorDefinitions.map(({ aliases }) => aliases[0]), [
    "icloud", "shop", "gmail", "outlook", "amazon", "instacart", "airbnb"
  ]);
  assert.equal(resolveConnector("google").binary, "gog");
  assert.equal(resolveConnector("microsoft").binary, "outlook-email-pp-cli");
  assert.equal(resolveConnector("source_amazon_orders").binary, "amazon-orders-pp-cli");
  assert.throws(() => resolveConnector("../../bin/sh"), /Unknown connector/);
});

test("setup inspects availability and auth without installing or logging in", async () => {
  const runner = fakeRunner({ installed: true, statusOk: false });
  const result = await setupConnector("gmail", { action: "setup", runner });

  assert.equal(result.installed, true);
  assert.equal(result.authState, "missing");
  assert.equal(result.liveAccess, "not_checked");
  assert.deepEqual(result.nextActions, ["koban sources login gmail --email ADDRESS"]);
  assert.deepEqual(runner.calls, [{
    args: ["status", "--json", "--no-input"],
    binary: "gog",
    options: { capture: true, cwd: process.cwd(), env: process.env, shell: false, timeoutMs: 10_000 }
  }]);
});

test("login uses fixed safe arguments and inherited stdio", async () => {
  const runner = fakeRunner({ installed: true });
  await setupConnector("gmail", {
    action: "login",
    cwd: "/tmp/koban-test",
    email: "person@example.com",
    env: { PATH: "/fixed" },
    runner
  });

  assert.deepEqual(runner.calls, [{
    args: ["login", "person@example.com", "--readonly", "--services=gmail,calendar", "--gmail-no-send"],
    binary: "gog",
    options: { cwd: "/tmp/koban-test", env: { PATH: "/fixed" }, shell: false, stdio: "inherit" }
  }]);
  await assert.rejects(
    setupConnector("gmail", { action: "login", runner: fakeRunner({ installed: true }) }),
    /requires --email/
  );
  await assert.rejects(
    setupConnector("gmail", {
      action: "login",
      email: "--access-token=secret",
      runner: fakeRunner({ installed: true })
    }),
    /valid email address/
  );
});

test("Outlook login requests read-only mail scopes", async () => {
  const runner = fakeRunner({ installed: true });
  await setupConnector("outlook", { action: "login", runner });
  assert.deepEqual(runner.calls[0].args, [
    "auth", "login", "--device-code", "--scopes", "Mail.Read User.Read offline_access", "--launch"
  ]);
  assert.equal(runner.calls[0].options.shell, false);
});

test("install and add execute only fixed allowlisted commands", async () => {
  const installRunner = fakeRunner({ installed: false });
  await setupConnector("amazon", { action: "install", runner: installRunner });
  assert.deepEqual(installRunner.calls[0], {
    binary: "npx",
    args: ["-y", "@mvanhorn/printing-press-library", "install", "amazon-orders", "--cli-only"],
    options: { cwd: process.cwd(), env: process.env, shell: false, stdio: "inherit" }
  });

  const addRunner = fakeRunner({ installed: false, installedAfterRun: true });
  await setupConnector("instacart", { action: "add", runner: addRunner });
  assert.deepEqual(addRunner.calls.map(({ binary, args }) => [binary, args]), [
    ["npx", ["-y", "@mvanhorn/printing-press-library", "install", "instacart", "--cli-only"]],
    ["instacart-pp-cli", ["auth", "login"]]
  ]);
});

test("dry runs report actions without spawning commands", async () => {
  const runner = fakeRunner({ installed: false });
  const result = await setupConnector("airbnb", { action: "add", dryRun: true, runner });
  assert.deepEqual(result.executed, []);
  assert.deepEqual(result.planned, ["install", "login"]);
  assert.equal(result.dryRun, true);
  assert.deepEqual(runner.calls, []);
});

test("inspection distinguishes missing credentials from unverified and verified access", async () => {
  const missingGmail = await inspectConnector("gmail", {
    runner: fakeRunner({ installed: true, stdout: JSON.stringify({ config: { exists: false } }) })
  });
  assert.equal(missingGmail.authState, "missing");
  assert.equal(missingGmail.liveAccess, "not_checked");

  const storedOutlook = await inspectConnector("outlook", {
    runner: fakeRunner({ installed: true, stdout: "Credentials present (not verified)" })
  });
  assert.equal(storedOutlook.authState, "credentials_present");
  assert.equal(storedOutlook.liveAccess, "not_checked");

  const ambiguousGmail = await inspectConnector("gmail", {
    runner: fakeRunner({ installed: true, stdout: "configuration exists" })
  });
  assert.equal(ambiguousGmail.authState, "unverified");

  const verifiedInstacart = await inspectConnector("instacart", {
    verify: true,
    runner: fakeRunner({ installed: true, outputs: ["Authenticated", JSON.stringify({ ok: true })] })
  });
  assert.equal(verifiedInstacart.authState, "credentials_present");
  assert.equal(verifiedInstacart.liveAccess, "verified");

  const falsePositiveInstacart = await inspectConnector("instacart", {
    verify: true,
    runner: fakeRunner({ installed: true, outputs: ["Authenticated", JSON.stringify({ ok: false })] })
  });
  assert.equal(falsePositiveInstacart.authState, "credentials_present");
  assert.equal(falsePositiveInstacart.liveAccess, "failed");

  const outlookRunner = fakeRunner({
    installed: true,
    outputs: ["Credentials present (not verified)", "Token refreshed.", JSON.stringify({ meta: { source: "live" }, results: { value: [{ id: "m1" }] } })]
  });
  const wrappedOutlook = await inspectConnector("outlook", { verify: true, runner: outlookRunner });
  assert.equal(wrappedOutlook.liveAccess, "verified");
  assert.ok(outlookRunner.calls.some((call) => call.args.join(" ") === "auth refresh --scopes Mail.Read User.Read offline_access"));

  const doctorAmazon = await inspectConnector("amazon", {
    verify: true,
    runner: fakeRunner({ installed: true, outputs: ["Authenticated", JSON.stringify({ api: "reachable", credentials: "valid" })] })
  });
  assert.equal(doctorAmazon.liveAccess, "verified");

  const staleAmazon = await inspectConnector("amazon", {
    verify: true,
    runner: fakeRunner({ installed: true, outputs: ["Authenticated", JSON.stringify({ api: "reachable", credentials: "invalid (browser-session proof missing or stale)" })] })
  });
  assert.equal(staleAmazon.liveAccess, "failed");
});

test("login fails clearly when the binary is missing", async () => {
  await assert.rejects(
    setupConnector("airbnb", { action: "login", runner: fakeRunner({ installed: false }) }),
    /is not installed.*sources install airbnb/
  );
});

function fakeRunner({ installed, installedAfterRun = installed, statusOk = true, stdout = "Authenticated", outputs }) {
  const calls = [];
  let runCount = 0;
  return {
    calls,
    async commandExists() {
      return runCount > 0 ? installedAfterRun : installed;
    },
    async run(binary, args, options) {
      calls.push({ args, binary, options });
      runCount += 1;
      if (options.capture && !statusOk) throw new Error("not authenticated");
      if (options.capture) return { stderr: "", stdout: outputs?.shift() ?? stdout };
    }
  };
}
