#!/usr/bin/env node

import { mkdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { executeOperation, KobanClientError, listOperations, resolveConfiguration } from "./client.js";
import { parseGlobalOptions, parseNativeCommand } from "./commands.js";

export async function runCli(argv = process.argv.slice(2), io = console, runtime = {}) {
  const env = runtime.env ?? process.env;
  const stdoutIsTTY = runtime.stdoutIsTTY ?? process.stdout.isTTY === true;
  if (argv[0] === "call") return runLegacyCall(argv.slice(1), io, env);

  const { args, global } = parseGlobalOptions(argv);
  const outputJson = global.json || !stdoutIsTTY;
  const command = await parseNativeCommand(args, { readStdin: runtime.readStdin });
  if (global.profile !== undefined) {
    if (command.kind === "connector") command.options.profile = global.profile;
    else if (command.kind === "operation" && (command.args.source_id || command.args.source_ids)) {
      const { mailSourceId } = await import("./mail-accounts.js");
      if (command.args.source_ids) usageError("Select one mail source when using --profile.");
      const { resolveConnector } = await import("./connectors.js");
      command.args.source_id = mailSourceId(resolveConnector(command.args.source_id).aliases[0], global.profile);
    } else if (command.kind !== "help") usageError("--profile selects a named mail connector. Use it with connectors or sources commands.");
  }
  const commandEnv = environmentFor(global, env);

  if (command.kind === "help") return output(io, command.text, false);
  if (command.kind === "version") return output(io, `koban ${await packageVersion()}`, false);
  if (command.kind === "connector") {
    return runConnectorCommand(command, commandEnv, io, outputJson);
  }
  if (command.kind === "tools") return output(io, { tools: listOperations() }, true);
  if (command.kind === "schema") {
    const name = command.argv[1];
    if (command.argv.length > 2) usageError("Usage: koban schema [TOOL]");
    const tools = listOperations();
    const value = name ? tools.find((tool) => tool.name === name)?.inputSchema : Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
    if (!value) usageError(`Unknown tool: ${name}`);
    return output(io, value, true);
  }
  if (command.kind === "doctor") {
    if (command.argv.length > 1) usageError("Usage: koban doctor");
    const configuration = await resolveConfiguration({ env: commandEnv });
    await executeOperation("koban_get_sync_status", {}, { configuration });
    return output(io, {
      backend: "reachable",
      baseUrl: configuration.baseUrl,
      ok: true,
      syncTimeoutMs: configuration.timeoutMs ?? 120_000,
      timeoutMs: configuration.timeoutMs ?? 30_000,
      tokenSource: configuration.tokenSource,
      toolCount: listOperations().length
    }, outputJson);
  }
  if (command.kind === "mcp") {
    if (command.argv.length > 1) usageError("Usage: koban mcp");
    const { runMcpServer } = await import("./mcp.js");
    await runMcpServer({ clientOptions: { env: commandEnv } });
    return 0;
  }
  if (command.kind === "operation") {
    if (command.args.source_id || command.args.source_ids) {
      const { resolveConnector } = await import("./connectors.js");
      const normalize = (id) => id.startsWith("source_") ? id : sourceIdFor(resolveConnector(id).aliases[0]);
      if (command.args.source_id) command.args.source_id = normalize(command.args.source_id);
      if (command.args.source_ids) command.args.source_ids = command.args.source_ids.map(normalize);
    }
    return output(io, await executeOperation(command.operation, command.args, { env: commandEnv }), outputJson);
  }
  usageError("Unsupported command.");
}

const sourceIdFor = (name) => ({ icloud: "source_icloud_mail", shop: "source_shop_orders", gmail: "source_gmail", outlook: "source_outlook_email", amazon: "source_amazon_orders", instacart: "source_instacart", airbnb: "source_airbnb" })[name];

async function runConnectorCommand(command, env, io, outputJson) {
  const { connectorDefinitions, resolveConnector, setupConnector, inspectConnector } = await import("./connectors.js");
  if (command.action === "accounts") {
    const { requestMailAccounts } = await import("./mail-accounts.js");
    const response = await requestMailAccounts(await resolveConfiguration({ env }));
    const provider = command.connector ? resolveConnector(command.connector).aliases[0] : undefined;
    return output(io, { data: response.data.filter((account) => !provider || account.provider === provider) }, outputJson);
  }
  const bankConnectors = ["plaid", "snaptrade", "simplefin", "financekit"];
  if (bankConnectors.includes(command.connector)) {
    const configuration = await resolveConfiguration({ env });
    const setupUrl = new URL("settings", `${configuration.baseUrl}/`).href;
    if (command.action === "status") {
      const sync = await executeOperation("koban_get_sync_status", {}, { configuration });
      return output(io, {
        connector: command.connector, backend_status: sync[command.connector] ?? null,
        live_access: "not_checked", setup_url: setupUrl,
        note: "These are backend readiness and stored sync results, not a fresh bank authentication test."
      }, outputJson);
    }
    if (["add", "login"].includes(command.action) && !command.options.dryRun) {
      if (outputJson) usageError("Use --dry-run --json to inspect browser setup, or run without --json in a terminal.");
      const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
      if (!opener) usageError(`Open ${setupUrl} to connect ${command.connector}.`);
      await promisify(execFile)(opener, [setupUrl], { timeout: 5000 });
    }
    return output(io, {
      connector: command.connector, setup: "browser", url: setupUrl,
      next_action: `Use Settings → Connections for ${command.connector}. Bank consent and credentials remain in the browser.`,
      note: command.connector === "financekit" ? "FinanceKit also requires the iOS companion and device authorization." : undefined
    }, outputJson);
  }
  if (command.action === "list") {
    const definitions = command.connector ? [resolveConnector(command.connector)] : connectorDefinitions;
    return output(io, { data: definitions.map((definition) => ({
      id: definition.aliases[0], name: definition.displayName, binary: definition.binary,
      source_id: sourceIdFor(definition.aliases[0]),
      setup: `koban connectors add ${definition.aliases[0]}${definition.aliases[0] === "gmail" ? " --email ADDRESS" : ""}`
    })), browser_setup: command.connector ? [] : bankConnectors.map((id) => ({ id, setup: `koban connectors add ${id}` })) }, outputJson);
  }
  const configuration = await resolveConfiguration({ env });
  const host = new URL(configuration.baseUrl).hostname;
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(host);
  const selected = command.connector ? resolveConnector(command.connector).aliases[0] : undefined;
  // A mailbox only syncs once it is registered as a profile, so an unnamed
  // Gmail/Outlook login reuses the profile holding that address or creates one.
  if (local && !command.options.profile && ["gmail", "outlook"].includes(selected) && ["add", "login"].includes(command.action) && command.options.email) {
    const { requestMailAccounts } = await import("./mail-accounts.js");
    const email = command.options.email.trim().toLowerCase();
    const registered = await requestMailAccounts(configuration).then((value) => value.data ?? [], () => []);
    const existing = registered.find((account) => account.provider === selected && account.email?.toLowerCase() === email);
    command.options.profile = existing?.profile ?? profileFromEmail(email);
  }
  if (command.options.profile || selected === "icloud") {
    if (!selected || !["gmail", "outlook", "icloud"].includes(selected)) usageError("--profile requires gmail, outlook or icloud.");
    return runMailProfile(command, selected, configuration, env, io, outputJson);
  }
  if (command.options.passwordFile) usageError("--password-file is supported only for a named iCloud profile.");
  if (command.options.cookieFile && selected !== "shop") usageError("--cookie-file is supported only for Shop.");
  if (command.options.chrome && selected !== "shop") usageError("--chrome is supported only for Shop; Amazon and Airbnb read Chrome during their own login.");
  if (command.options.chrome && command.options.cookieFile) usageError("Use --chrome or --cookie-file, not both.");
  if (selected === "shop" && ["setup", "install", "login", "add"].includes(command.action)) {
    const { readShopCookieFile, readShopCookieFromChrome, requestShopSession } = await import("./shop-session.js");
    const next = "Sign in at https://shop.app/account/order-history in Chrome until your orders show, then run koban connectors login shop --chrome (or save the Cookie header to a private file and use --cookie-file PATH).";
    if (["login", "add"].includes(command.action) && (command.options.cookieFile || command.options.chrome)) {
      if (command.options.dryRun) return output(io, { connector: "shop", planned: ["save_session"], executed: [], next_action: "koban connectors status shop --verify" }, outputJson);
      const cookie = command.options.chrome ? await readShopCookieFromChrome() : await readShopCookieFile(command.options.cookieFile);
      const result = await requestShopSession(configuration, { cookie });
      return output(io, { connector: "shop", ...result, next_action: "koban connectors status shop --verify", sync_command: "koban sources sync shop" }, outputJson);
    }
    if (["login", "add"].includes(command.action) && !command.options.dryRun) {
      if (outputJson || !process.stdout.isTTY) usageError(next);
      const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
      if (opener) await promisify(execFile)(opener, ["https://shop.app/account/order-history"], { timeout: 5000 });
    }
    return output(io, { connector: "shop", installed: true, built_in: true, experimental: true, next_action: next }, outputJson);
  }
  if (command.action === "setup") {
    return output(io, {
      ...await setupConnector(command.connector, { ...command.options, action: "setup", env }),
      local_probe_host: "this machine", backend_is_local: local,
      note: local ? "Run connectors status --verify to check live access and backend imports." : "Install/login must run on the backend host, not this machine."
    }, outputJson);
  }
  if (["add", "login", "install"].includes(command.action)) {
    if (!local) usageError("Connector login/install affects this machine, but your backend is remote. Run setup on the backend host instead.");
    if (!command.options.dryRun && (!process.stdin.isTTY || !process.stdout.isTTY || outputJson)) {
      usageError("Run login/install in an interactive terminal without --json, or use --dry-run to inspect the steps.");
    }
    const result = await setupConnector(command.connector, { ...command.options, action: command.action, env });
    const name = resolveConnector(command.connector).aliases[0];
    return output(io, { ...result, next_action: `koban connectors status ${name} --verify`, import_after_login: `koban sources sync ${name}` }, outputJson);
  }
  const definitions = command.connector ? [resolveConnector(command.connector)] : connectorDefinitions;
  let backend;
  let backendAvailable = true;
  try { backend = await executeOperation("koban_get_source_diagnostics", {}, { configuration }); }
  catch { backendAvailable = false; }
  const rows = [];
  let mailAccounts = [];
  if (backendAvailable && definitions.some((definition) => ["gmail", "outlook"].includes(definition.aliases[0]))) {
    const { requestMailAccounts } = await import("./mail-accounts.js");
    mailAccounts = await requestMailAccounts(configuration).then((value) => value.data ?? [], () => []);
  }
  for (const definition of definitions) {
    const name = definition.aliases[0];
    const profiles = ["gmail", "outlook"].includes(name) ? mailAccounts.filter((account) => account.provider === name) : [];
    if (profiles.length) {
      for (const account of profiles) {
        const state = await inspectConnector(name, { email: account.email, outlookConfigPath: account.auth_config_path, verify: command.options.verify, env });
        const stored = backend?.data?.find((item) => item.id === account.id);
        const scope = `--profile ${account.profile}`;
        rows.push({
          id: `${name}:${account.profile}`, name: `${definition.displayName} · ${account.email}`,
          binary: state.binary, installed: state.installed,
          authentication: state.authState,
          live_access: state.liveAccess ?? "not_checked",
          next_action: !state.installed ? `koban connectors install ${name}`
            : state.authState === "missing" || state.liveAccess === "failed" ? `koban connectors login ${name} ${scope}`
              : state.liveAccess === "verified" ? `koban sources sync ${name} ${scope}` : `koban connectors status ${name} ${scope} --verify`,
          imported_records: stored?.storage?.source_item_count ?? null,
          latest_record: stored?.storage?.latest_occurred_at ?? null,
          backend_status: stored?.status ?? "unavailable",
          backend_refresh_needs_attention: Boolean(stored?.refresh_message || stored?.error_message),
          setup_command: `koban connectors add ${name} --email ADDRESS`,
          sync_command: `koban sources sync ${name} ${scope}`
        });
      }
      continue;
    }
    let state;
    if (name === "shop") {
      const { requestShopSession } = await import("./shop-session.js");
      try {
        const session = await requestShopSession(configuration, { verify: command.options.verify });
        state = { binary: "built-in", installed: true, authState: session.configured ? "credentials_present" : "missing", liveAccess: session.live_access };
      } catch { state = { binary: "built-in", installed: true, authState: "unverified", liveAccess: "unavailable" }; }
    } else state = await inspectConnector(name, { verify: command.options.verify, env });
    const stored = backend?.data?.find((item) => item.id === sourceIdFor(name));
    rows.push({
      id: name, name: definition.displayName,
      binary: state.binary, installed: state.installed,
      authentication: state.authState,
      live_access: state.liveAccess ?? (command.options.verify ? state.authState === "verified" ? "verified" : "failed" : "not_checked"),
      next_action: !state.installed ? `koban connectors install ${name}`
        : state.authState === "missing" || state.liveAccess === "failed"
          ? `koban connectors login ${name}${name === "gmail" ? " --email ADDRESS" : name === "shop" ? " --chrome" : ""}`
          : state.liveAccess === "verified" ? `koban sources sync ${name}` : `koban connectors status ${name} --verify`,
      imported_records: stored?.storage?.source_item_count ?? null,
      latest_record: stored?.storage?.latest_occurred_at ?? null,
      backend_status: stored?.status ?? "unavailable",
      backend_refresh_needs_attention: Boolean(stored?.refresh_message || stored?.error_message),
      setup_command: `koban connectors add ${name}${name === "gmail" ? " --email ADDRESS" : ""}`,
      sync_command: `koban sources sync ${name}`
    });
  }
  let bankStatus;
  if (!command.connector && backendAvailable) {
    try {
      const sync = await executeOperation("koban_get_sync_status", {}, { configuration });
      bankStatus = ["plaid", "snaptrade", "simplefin"].map((name) => ({
        id: name, configured: sync[name]?.configured, ready_for_sync: sync[name]?.ready_for_sync,
        connections: sync[name]?.connection_count ?? sync[name]?.item_count ?? 0,
        accounts: sync[name]?.stored_account_count ?? 0, last_synced_at: sync[name]?.last_synced_at ?? null
      }));
    } catch { bankStatus = { available: false }; }
  }
  return output(io, { data: rows, bank_connectors: bankStatus, backend_available: backendAvailable, local_probe_host: "this machine", backend_is_local: local }, outputJson);
}

async function runMailProfile(command, provider, configuration, env, io, outputJson) {
  const { mailSourceId, readAppPasswordFile, requestMailAccounts } = await import("./mail-accounts.js");
  const { inspectConnector, setupConnector } = await import("./connectors.js");
  const profile = command.options.profile;
  const setup = `koban connectors add ${provider} --profile personal --email you@example.com${provider === "icloud" ? " --password-file PATH" : ""}`;
  if (!profile) {
    if (provider === "icloud" && ["setup", "status", "install"].includes(command.action)) {
      return output(io, { connector: provider, installed: true, next_action: setup, note: "Create an app-specific password in your Apple Account. Mail is read over TLS; messages are not marked read." }, outputJson);
    }
    usageError(`Select a named profile. Example: ${setup}`);
  }
  const id = mailSourceId(provider, profile);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(configuration.baseUrl).hostname);
  if (command.options.passwordFile && provider !== "icloud") usageError("--password-file is only for iCloud app-specific passwords.");
  if (!local && provider !== "icloud" && ["add", "login", "install"].includes(command.action)) usageError("Gmail/Outlook login must run on the backend host.");
  if (command.options.dryRun) return output(io, { provider, profile, id, planned: ["register_profile", provider === "icloud" ? "save_app_specific_password" : "interactive_login"], executed: [] }, outputJson);
  if (provider !== "icloud" && ["add", "login", "install"].includes(command.action) && (!process.stdin.isTTY || !process.stdout.isTTY || outputJson)) usageError("Run Gmail/Outlook profile login in an interactive terminal without --json, or inspect it with --dry-run.");
  let account;
  try { account = await requestMailAccounts(configuration, { id }); }
  catch (error) { if (!(error instanceof KobanClientError) || error.status !== 404) throw error; }
  if (["add", "login"].includes(command.action)) {
    const email = command.options.email ?? account?.email;
    if (!email) usageError("--email is required when adding a new mail profile.");
    if (provider === "icloud" && !command.options.passwordFile) usageError("iCloud login requires --password-file PATH containing an app-specific password, not your Apple Account password.");
    const password = provider === "icloud" ? await readAppPasswordFile(command.options.passwordFile) : undefined;
    account = await requestMailAccounts(configuration, { account: { provider, profile, email, ...(command.options.label ? { label: command.options.label } : {}), ...(password ? { app_password: password } : {}) } });
    if (provider !== "icloud") {
      if (account.auth_config_path) {
        const allowed = path.join(os.homedir(), ".config", "koban", "mail-profiles", "outlook") + path.sep;
        if (!path.resolve(account.auth_config_path).startsWith(allowed)) usageError("The Outlook profile belongs to another backend host.");
        await mkdir(path.dirname(account.auth_config_path), { recursive: true, mode: 0o700 });
      }
      await setupConnector(provider, { action: command.action, email: account.email, outlookConfigPath: account.auth_config_path, env });
    }
    return output(io, { account, authenticated: "not_verified", next_action: `koban connectors status ${provider} --profile ${profile} --verify`, sync_command: `koban sources sync ${provider} --profile ${profile}` }, outputJson);
  }
  if (!account) return output(io, { provider, profile, registered: false, next_action: setup.replace("personal", profile) }, outputJson);
  if (command.action === "install") {
    return output(io, provider === "icloud" ? { installed: true, built_in: true } : await setupConnector(provider, { action: "install", env }), outputJson);
  }
  let access = { installed: true, authState: "unverified", liveAccess: "not_checked" };
  if (provider !== "icloud" && local) access = await inspectConnector(provider, { email: account.email, outlookConfigPath: account.auth_config_path, verify: command.options.verify, env });
  if (provider === "icloud" && command.options.verify) {
    const { verifyMailAccount } = await import("./mail-accounts.js");
    const result = await verifyMailAccount(configuration, id);
    access = { installed: true, authState: result.configured ? "credentials_present" : "missing", liveAccess: result.live_access };
  }
  const sources = await executeOperation("koban_get_source_diagnostics", {}, { configuration });
  const source = sources.data?.find((item) => item.id === id);
  const nextAction = access.liveAccess === "verified" ? `koban sources sync ${provider} --profile ${profile}`
    : access.liveAccess === "failed" || access.authState === "missing" ? `koban connectors login ${provider} --profile ${profile}${provider === "icloud" ? " --password-file PATH" : ""}`
    : `koban connectors status ${provider} --profile ${profile} --verify`;
  return output(io, { account, ...access, local_probe_host: local ? "backend host" : "not probed remotely", imported_records: source?.storage?.source_item_count ?? 0, latest_record: source?.storage?.latest_occurred_at ?? null, next_action: nextAction }, outputJson);
}

async function runLegacyCall(argv, io, env) {
  const [name, jsonFlag, jsonText, ...extra] = argv;
  if (!name || jsonFlag !== "--json" || jsonText === undefined || extra.length) usageError("Usage: koban call <tool> --json '<arguments>'");
  let args;
  try { args = JSON.parse(jsonText); } catch { usageError("--json must contain valid JSON."); }
  return output(io, await executeOperation(name, args, { env }), true);
}

function environmentFor(global, inherited) {
  return {
    ...inherited,
    ...(global.config === undefined ? {} : { KOBAN_CONFIG: global.config }),
    ...(global.base_url === undefined ? {} : { KOBAN_BASE_URL: global.base_url }),
    ...(global.timeout === undefined ? {} : { KOBAN_TIMEOUT_MS: global.timeout })
  };
}

function output(io, value, json) {
  io.log(json ? stableJson(value) : typeof value === "string" ? value : humanText(value));
  return 0;
}

function stableJson(value) { return JSON.stringify(sortValue(value), null, 2); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}
function humanText(value) {
  if (value == null) return "No data returned.";
  const rows = Array.isArray(value) ? value : Array.isArray(value.data) ? value.data : undefined;
  if (rows) {
    if (!rows.length) return "No results.";
    const fields = ["id", "date", "merchant_name", "name", "display_name", "amount", "currency", "category_id", "status", "provider", "profile", "email", "label", "installed", "authentication", "live_access", "imported_records", "latest_record", "next_action", "configured", "connections", "accounts", "setup", "tags"]
      .filter((field) => rows.some((row) => row && typeof row === "object" && row[field] !== undefined));
    const lines = fields.length
      ? alignedTable(fields.map((field) => field.replaceAll("_", " ")), rows.map((row) => fields.map((field) => oneLine(row[field] ?? "") || "-")))
      : rows.map((row) => `- ${oneLine(row)}`);
    lines.push("", `${rows.length} result(s)${value.total_count === undefined ? "" : ` of ${value.total_count}`}${value.has_more ? "; more available. Use --starting-after with the last ID." : ""}`);
    if (Array.isArray(value.bank_connectors)) lines.push("", "Bank connectors (backend status, not a fresh bank login test):", humanText(value.bank_connectors));
    if (Array.isArray(value.browser_setup) && value.browser_setup.length) lines.push("", "Bank and device setup:", humanText(value.browser_setup));
    if (value.backend_is_local === false) lines.push("", "Local login probes describe this machine; imported records describe the remote backend.");
    return lines.join("\n");
  }
  return Object.entries(value).map(([key, item]) => `${key.replaceAll("_", " ")}: ${oneLine(item)}`).join("\n");
}
function profileFromEmail(email) {
  const slug = email.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
  if (!slug) usageError("Use --profile NAME for this address.");
  return slug;
}
function alignedTable(header, rows) {
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((cells) => cells[index].length)));
  const line = (cells) => cells.map((cell, index) => index === cells.length - 1 ? cell : cell.padEnd(widths[index])).join("  ");
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
}
function oneLine(value) { return sanitize(value && typeof value === "object" ? JSON.stringify(sortValue(value)) : String(value)); }
function sanitize(value) { return value.replace(/[\u0000-\u001f\u007f]/g, " "); }
async function packageVersion() { return JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version; }
function usageError(message) { throw new KobanClientError(message, { code: "USAGE_ERROR" }); }
function safeCliError(error, json) {
  const code = error instanceof KobanClientError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof KobanClientError ? error.message : "Koban command failed.";
  return json ? stableJson({ error: { code, message: sanitize(message) }, ok: false }) : `${code}: ${sanitize(message)}`;
}
async function isMainModule() {
  if (!process.argv[1]) return false;
  try { return await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (await isMainModule()) {
  const json = process.argv.includes("--json") && process.argv[2] !== "call" || process.stdout.isTTY !== true;
  runCli().then((code) => { process.exitCode = code; }, (error) => {
    console.error(safeCliError(error, json));
    process.exitCode = error instanceof KobanClientError && ["USAGE_ERROR", "INVALID_ARGUMENTS"].includes(error.code) ? 2 : 1;
  });
}
