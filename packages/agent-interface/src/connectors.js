import { spawn } from "node:child_process";
import { KobanClientError } from "./client.js";

const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 10_000;

export const connectorDefinitions = Object.freeze([
  connector({ aliases: ["icloud", "icloud_mail", "source_icloud_mail"], binary: "built-in", displayName: "iCloud Mail", builtIn: true }),
  connector({
    aliases: ["shop", "shop_orders", "source_shop_orders"],
    binary: "built-in", displayName: "Shop orders", builtIn: true
  }),
  connector({
    aliases: ["gmail", "google", "source_gmail"],
    binary: "gog",
    displayName: "Gmail",
    install: ["brew", ["install", "gogcli/tap/gog"]],
    login: ({ email }) => {
      if (!email) connectorError("Gmail login requires --email ADDRESS.");
      if (!/^[^\s@-][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email)) {
        connectorError("Gmail --email must be a valid email address.");
      }
      return ["gog", ["login", email, "--readonly", "--services=gmail,calendar", "--gmail-no-send"]];
    },
    status: ["gog", ["status", "--json", "--no-input"]],
    verify: ["gog", ["gmail", "search", "newer_than:1d", "--json", "--results-only", "--gmail-no-send", "--readonly", "--no-input"]]
  }),
  connector({
    aliases: ["outlook", "microsoft", "outlook-email", "source_outlook_email"],
    binary: "outlook-email-pp-cli",
    displayName: "Outlook email",
    install: ["npx", ["-y", "@mvanhorn/printing-press-library", "install", "outlook-email", "--cli-only"]],
    login: () => ["outlook-email-pp-cli", [
      "auth", "login", "--device-code", "--scopes", "Mail.Read User.Read offline_access", "--launch"
    ]],
    // Access tokens last about an hour; refresh with the granted read-only
    // scopes, since the CLI's default refresh asks for read-write ones.
    refresh: ["outlook-email-pp-cli", ["auth", "refresh", "--scopes", "Mail.Read User.Read offline_access"]],
    status: ["outlook-email-pp-cli", ["auth", "status"]],
    verify: ["outlook-email-pp-cli", ["messages", "list", "--data-source", "live", "--no-cache", "--top", "1", "--select-fields", "id", "--json", "--timeout", "10s"]]
  }),
  connector({
    aliases: ["amazon", "amazon-orders", "source_amazon_orders"],
    binary: "amazon-orders-pp-cli",
    displayName: "Amazon orders",
    install: ["npx", ["-y", "@mvanhorn/printing-press-library", "install", "amazon-orders", "--cli-only"]],
    login: () => ["amazon-orders-pp-cli", ["auth", "login", "--chrome"]],
    status: ["amazon-orders-pp-cli", ["auth", "status"]],
    verify: ["amazon-orders-pp-cli", ["doctor", "--json"]]
  }),
  connector({
    aliases: ["instacart", "source_instacart"],
    binary: "instacart-pp-cli",
    displayName: "Instacart",
    install: ["npx", ["-y", "@mvanhorn/printing-press-library", "install", "instacart", "--cli-only"]],
    login: () => ["instacart-pp-cli", ["auth", "login"]],
    status: ["instacart-pp-cli", ["auth", "status"]],
    verify: ["instacart-pp-cli", ["doctor", "--json"]]
  }),
  connector({
    aliases: ["airbnb", "source_airbnb"],
    binary: "airbnb-pp-cli",
    displayName: "Airbnb",
    install: ["npx", ["-y", "@mvanhorn/printing-press-library", "install", "airbnb", "--cli-only"]],
    login: () => ["airbnb-pp-cli", ["auth", "login", "--chrome"]],
    status: ["airbnb-pp-cli", ["auth", "status"]]
  })
]);

const connectorByAlias = new Map(
  connectorDefinitions.flatMap((definition) => definition.aliases.map((alias) => [alias, definition]))
);

export function resolveConnector(name) {
  const normalized = typeof name === "string" ? name.trim().toLowerCase() : "";
  const definition = connectorByAlias.get(normalized);
  if (!definition) {
    connectorError(`Unknown connector: ${name}. Choose gmail, outlook, amazon, instacart, airbnb, shop, or icloud.`);
  }
  return definition;
}

export async function setupConnector(name, options = {}) {
  const definition = resolveConnector(name);
  if (definition.builtIn) connectorError("Shop session setup is provided by koban connectors login shop --cookie-file PATH.");
  const action = options.action ?? "setup";
  if (!["add", "install", "login", "setup"].includes(action)) connectorError(`Unsupported connector action: ${action}`);
  const runner = options.runner ?? createConnectorRunner();
  let installed = await runner.commandExists(definition.binary);

  if (action === "setup") {
    const inspection = await inspectConnector(name, { ...options, runner });
    return {
      action,
      authState: inspection.authState,
      binary: definition.binary,
      connector: definition.aliases[0],
      displayName: definition.displayName,
      installed,
      liveAccess: inspection.liveAccess,
      nextActions: installed
        ? inspection.liveAccess === "verified"
          ? []
          : inspection.authState === "missing"
            ? [`koban sources login ${definition.aliases[0]}${definition.aliases[0] === "gmail" ? " --email ADDRESS" : ""}`]
            : definition.verify
              ? [`koban connectors status ${definition.aliases[0]} --verify`]
              : [`koban sources login ${definition.aliases[0]}`]
        : [
            `koban sources install ${definition.aliases[0]}`,
            `koban sources login ${definition.aliases[0]}${definition.aliases[0] === "gmail" ? " --email ADDRESS" : ""}`
          ],
      ready: inspection.liveAccess === "verified"
    };
  }

  const executed = [];
  const planned = [];
  let loginCommand = action === "login" || action === "add"
    ? definition.login({ email: cleanString(options.email) })
    : undefined;
  if (loginCommand && definition.aliases[0] === "outlook" && options.outlookConfigPath) {
    loginCommand = [loginCommand[0], ["--config", options.outlookConfigPath, ...loginCommand[1]]];
  }
  if ((action === "install" || action === "add") && !installed) {
    planned.push("install");
    await runFixedCommand(definition.install, runner, options, "install");
    if (!options.dryRun) executed.push("install");
    if (!options.dryRun) installed = await runner.commandExists(definition.binary);
  }
  if (action === "install") {
    return result(definition, action, installed, executed, planned, options.dryRun);
  }
  if (!installed && !options.dryRun) {
    connectorError(`${definition.binary} is not installed. Run koban sources install ${definition.aliases[0]}.`);
  }

  planned.push("login");
  await runFixedCommand(loginCommand, runner, options, "login");
  if (!options.dryRun) executed.push("login");
  return result(definition, action, installed, executed, planned, options.dryRun);
}

export async function inspectConnector(name, options = {}) {
  const definition = resolveConnector(name);
  if (definition.builtIn) return inspection(definition, true, "unverified", "not_checked");
  const runner = options.runner ?? createConnectorRunner();
  const installed = await runner.commandExists(definition.binary);
  if (!installed) return inspection(definition, false, "missing", "not_checked");

  const scoped = (command) => {
    if (definition.aliases[0] === "gmail" && options.email) return [command[0], [...command[1], "--account", options.email]];
    if (definition.aliases[0] === "outlook" && options.outlookConfigPath) return [command[0], ["--config", options.outlookConfigPath, ...command[1]]];
    return command;
  };
  const authProbe = await probe(scoped(definition.status), runner, options);
  const authState = classifyAuthProbe(definition, authProbe);
  if (!options.verify || authState === "missing" || !definition.verify) {
    return inspection(definition, true, authState, "not_checked");
  }

  if (definition.refresh) await probe(scoped(definition.refresh), runner, options);
  const liveProbe = await probe(scoped(definition.verify), runner, options);
  return inspection(
    definition,
    true,
    authState,
    liveProbe.ok && liveProbeConfirmsAccess(definition, liveProbe.stdout) ? "verified" : "failed"
  );
}

export function createConnectorRunner() {
  return {
    async commandExists(binary) {
      try {
        await spawnCommand("which", [binary], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    run(binary, args, options) {
      return options.capture
        ? spawnCaptured(binary, args, options)
        : spawnCommand(binary, args, options);
    }
  };
}

async function probe(command, runner, options) {
  try {
    const value = await runner.run(command[0], command[1], {
      capture: true,
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: false,
      timeoutMs: PROBE_TIMEOUT_MS
    });
    return { ok: true, stdout: value?.stdout ?? "", stderr: value?.stderr ?? "" };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
}

async function runFixedCommand(command, runner, options, kind) {
  const [binary, args] = command;
  if (options.dryRun) return;
  try {
    await runner.run(binary, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: false,
      stdio: "inherit"
    });
  } catch {
    connectorError(`${kind === "install" ? "Installation" : "Login"} failed for the selected connector.`);
  }
}

function result(definition, action, installed, executed, planned, dryRun) {
  return {
    action,
    connector: definition.aliases[0],
    displayName: definition.displayName,
    dryRun: dryRun === true,
    executed,
    installed,
    planned
  };
}

function inspection(definition, installed, authState, liveAccess) {
  return {
    authState,
    binary: definition.binary,
    connector: definition.aliases[0],
    displayName: definition.displayName,
    installed,
    liveAccess
  };
}

function classifyAuthProbe(definition, probeResult) {
  if (!probeResult.ok) return "missing";
  const text = `${probeResult.stdout}\n${probeResult.stderr}`.slice(0, MAX_PROBE_OUTPUT_BYTES);
  if (/not logged in|not authenticated|no credentials|credentials[^\n]*(?:false|missing)|login required/i.test(text)) {
    return "missing";
  }
  if (definition.aliases[0] === "gmail") {
    try {
      const payload = JSON.parse(probeResult.stdout);
      const accounts = payload.accounts ?? payload.data?.accounts;
      if (Array.isArray(accounts)) return accounts.length > 0 ? "credentials_present" : "missing";
      if (payload.credentials_exists === false) return "missing";
      if (payload.config?.exists === false) return "missing";
    } catch {
      return "unverified";
    }
  }
  return text.trim() ? "credentials_present" : "unverified";
}

function liveProbeConfirmsAccess(definition, stdout) {
  try {
    const payload = JSON.parse(stdout || "null");
    switch (definition.aliases[0]) {
      case "gmail":
        return Array.isArray(payload)
          || Array.isArray(payload?.messages)
          || Array.isArray(payload?.results)
          || Array.isArray(payload?.data);
      case "outlook":
        return Array.isArray(payload)
          || Array.isArray(payload?.value)
          || Array.isArray(payload?.results?.value)
          || Array.isArray(payload?.data);
      case "amazon":
        return payload?.ok === true || (payload?.credentials === "valid" && payload?.api === "reachable");
      case "instacart":
        return payload?.ok === true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function connector(definition) {
  return Object.freeze({ ...definition, aliases: Object.freeze(definition.aliases) });
}

function spawnCommand(binary, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `terminated by ${signal}` : `exited with ${code}`));
    });
  });
}

function spawnCaptured(binary, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let size = 0;
    let killTimer;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      killTimer.unref?.();
    }, options.timeoutMs);
    timer.unref?.();
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > MAX_PROBE_OUTPUT_BYTES) child.kill("SIGTERM");
      else if (target === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.once("error", (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (code === 0 && size <= MAX_PROBE_OUTPUT_BYTES) resolve({ stdout, stderr });
      else reject(new Error("connector probe failed"));
    });
  });
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function connectorError(message) {
  throw new KobanClientError(message, { code: "USAGE_ERROR" });
}
