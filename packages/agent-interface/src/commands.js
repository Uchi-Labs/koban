import { open } from "node:fs/promises";
import path from "node:path";
import { KobanClientError, listOperations } from "./client.js";

const commands = [
  command("accounts list", "koban_list_accounts"),
  command("accounts get", "koban_get_account", ["account_id"]),
  command("accounts update", "koban_update_account", ["account_id"]),
  command("categories list", "koban_list_categories"),
  command("categories create", "koban_create_category"),
  command("categories update", "koban_update_category", ["category_id"]),
  command("transactions list", "koban_list_transactions"),
  command("transactions get", "koban_get_transaction", ["transaction_id"]),
  command("transactions update", "koban_update_transaction", ["transaction_id"]),
  command("transactions tag", "koban_modify_transaction_tags", ["transaction_id"]),
  command("transactions categorize", "koban_update_transaction", ["transaction_id"], {
    aliases: { category: "category_id" }, only: ["transaction_id", "category_id"], required: ["category_id"]
  }),
  command("transactions bulk-categorize", "koban_bulk_categorize_transactions", [], {
    aliases: { category: "category_id" }
  }),
  command("transactions context", "koban_add_transaction_context_note", ["transaction_id"], {
    fileProperty: "body"
  }),
  command("transactions evidence", "koban_list_transaction_evidence", ["transaction_id"]),
  command("evidence list", "koban_list_evidence"),
  command("evidence attach", "koban_attach_transaction_evidence", ["transaction_id", "source_item_id"]),
  command("evidence review", "koban_review_transaction_evidence", ["transaction_id", "source_item_id"]),
  command("sources status", "koban_get_source_diagnostics"),
  command("sources sync", "koban_sync_sources", [], { variableSource: true }),
  command("sources import", "koban_import_source", ["source_id"], { fileProperty: "content" }),
  command("sources items", "koban_list_source_items"),
  command("sources search", "koban_search_source", ["source_id"]),
  command("tags list", "koban_list_tags"),
  command("tags set", "koban_upsert_tag", ["name"]),
  command("rules list", "koban_list_rules"),
  command("rules create", "koban_create_rule"),
  command("rules preview", "koban_preview_rule"),
  command("rules apply", "koban_apply_rules"),
  command("search", "koban_semantic_search", ["query"]),
  command("sync status", "koban_get_sync_status"),
  command("sync run", "koban_run_sync")
];

const operationByName = new Map(listOperations().map((operation) => [operation.name, operation]));
const commandByPath = new Map(commands.map((definition) => [definition.path, definition]));
const nouns = [...new Set(commands.map(({ path: commandPath }) => commandPath.split(" ")[0]))];

export function parseGlobalOptions(argv) {
  const args = [];
  const global = { json: false };
  const schemaTypes = new Map();
  for (const operation of operationByName.values()) {
    for (const [key, property] of Object.entries(operation.inputSchema.properties ?? {})) {
      schemaTypes.set(key, property);
    }
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") { args.push(...argv.slice(index)); break; }
    const [flag, inline] = splitOption(token);
    if (["--json", "--config", "--base-url", "--timeout", "--profile"].includes(flag)) {
      const key = flag.slice(2).replaceAll("-", "_");
      if (global[key] !== undefined && key !== "json") usageError(`${flag} may be supplied only once.`);
      if (flag === "--json") {
        if (inline !== undefined) usageError("--json does not take a value.");
        global.json = true;
      } else {
        global[key] = inline ?? requireOptionValue(argv, ++index, flag);
      }
      continue;
    }
    args.push(token);
    if (!token.startsWith("--") || inline !== undefined || ["--help", "--version"].includes(flag)) continue;
    const name = flag.slice(flag.startsWith("--no-") ? 5 : 2);
    const property = schemaTypes.get(optionAliases[name] ?? name.replaceAll("-", "_"));
    if (property && schemaIncludes(property, "boolean")) {
      if (["true", "false"].includes(argv[index + 1])) args.push(argv[++index]);
    } else if (flag === "--file" || property) {
      if (argv[index + 1] !== undefined) args.push(argv[++index]);
    }
  }
  return { args, global };
}

export async function parseNativeCommand(argv, { readStdin = defaultReadStdin } = {}) {
  if (argv.length === 0) return { kind: "help", text: rootHelp() };
  const helpArgs = argv[0] === "help" ? argv.slice(1) : argv;
  const helpAt = argv[0] === "help" || helpArgs[0] === "--help" || helpArgs[0] === "-h" ||
    helpArgs.some((token, index) => ["--help", "-h"].includes(token) &&
      (index === 0 || !takesValue(helpArgs[index - 1])) &&
      (helpArgs.indexOf("--") < 0 || index < helpArgs.indexOf("--")));
  if (helpAt) {
    const topic = commandByPath.has(helpArgs.slice(0, 2).join(" ")) || /^(connectors|sources) (add|setup|login|install|status|list|accounts)$/.test(helpArgs.slice(0, 2).join(" "))
      ? helpArgs.slice(0, 2).join(" ")
      : ["--help", "-h"].includes(helpArgs[0]) ? "" : helpArgs[0] ?? "";
    return { kind: "help", text: helpFor(topic) };
  }
  if (argv[0] === "--version" || argv[0] === "version") {
    if (argv.length !== 1) usageError("Usage: koban --version");
    return { kind: "version" };
  }
  if (argv[0] === "connectors" || (argv[0] === "sources" && ["add", "setup", "login", "install"].includes(argv[1]))) {
    const action = argv[1] ?? "list";
    if (!["list", "status", "setup", "add", "login", "install", "accounts"].includes(action)) usageError(`Unknown connector command: ${action}`);
    const options = { dryRun: false, verify: false };
    let connector;
    for (let index = 2; index < argv.length; index++) {
      const [flag, inline] = splitOption(argv[index]);
      if (["--email", "--cookie-file", "--password-file", "--label"].includes(flag)) {
        const key = { "--email": "email", "--cookie-file": "cookieFile", "--password-file": "passwordFile", "--label": "label" }[flag];
        if (options[key] !== undefined) usageError(`${flag} may be supplied only once.`);
        options[key] = inline ?? requireOptionValue(argv, ++index, flag);
      } else if (flag === "--dry-run" || flag === "--verify" || flag === "--chrome") {
        if (inline !== undefined) usageError(`${flag} does not take a value.`);
        options[{ "--chrome": "chrome", "--dry-run": "dryRun", "--verify": "verify" }[flag]] = true;
      } else if (flag.startsWith("-") || connector !== undefined) usageError(`Unexpected connector argument: ${argv[index]}`);
      else connector = argv[index];
    }
    if (!["list", "status", "accounts"].includes(action) && !connector) usageError(`Usage: koban connectors ${action} SOURCE [--email ADDRESS]`);
    if (options.verify && action !== "status") usageError("--verify is only supported by connectors status.");
    return { kind: "connector", action, connector, options };
  }
  if (["doctor", "tools", "schema", "mcp", "call"].includes(argv[0])) {
    if (argv[0] !== "schema" && argv[0] !== "call" && argv.length > 1) usageError(`Unexpected argument: ${argv[1]}`);
    return { argv, kind: argv[0] };
  }
  if (argv.length === 1 && nouns.includes(argv[0]) && !commandByPath.has(argv[0])) {
    return { kind: "help", text: helpFor(argv[0]) };
  }
  const pathLength = commandByPath.has(argv.slice(0, 2).join(" ")) ? 2 : 1;
  const commandPath = argv.slice(0, pathLength).join(" ");
  const definition = commandByPath.get(commandPath);
  if (!definition) usageError(`Unknown command: ${commandPath}`);
  const operation = operationByName.get(definition.operation);
  if (!operation) usageError(`Operation is unavailable: ${definition.operation}`);

  const commandSchema = definition.only ? {
    ...operation.inputSchema,
    properties: Object.fromEntries(Object.entries(operation.inputSchema.properties).filter(([key]) => definition.only.includes(key)))
  } : operation.inputSchema;
  const parsed = parseArguments(argv.slice(pathLength), definition, commandSchema);
  for (const key of definition.required ?? []) {
    if (parsed.args[key] === undefined) usageError(`--${key.replaceAll("_", "-")} is required.`);
  }
  if (definition.variableSource) {
    const sourceId = parsed.positionals.shift();
    if (sourceId) {
      if (parsed.args.source_ids !== undefined) usageError("Use a source ID or --source-ids, not both.");
      parsed.operation = "koban_sync_source";
      parsed.args.source_id = sourceId;
    } else {
      parsed.args.source_ids = parsed.args.source_ids ?? undefined;
    }
  }
  if (parsed.positionals.length > 0) usageError(`Unexpected argument: ${parsed.positionals[0]}`);
  if (definition.fileProperty) {
    await applyFileInput(parsed.args, definition.fileProperty, parsed.file, readStdin);
  } else if (parsed.file !== undefined) {
    usageError("--file is not supported by this command.");
  }
  return {
    args: parsed.args,
    kind: "operation",
    operation: parsed.operation ?? definition.operation
  };
}

export function rootHelp() {
  return [
    "Koban personal-finance CLI",
    "",
    "Usage: koban <command> [options]",
    "",
    "Commands:",
    "  accounts      List, inspect, and update accounts",
    "  categories    List, create, and update categories",
    "  transactions  Find and update transactions",
    "  evidence      List, attach, and review evidence",
    "  sources       Inspect, sync, and import connectors",
    "  connectors    Add connectors, log in, and check live access",
    "  tags          List and set tag styles",
    "  rules         List, create, preview, and apply rules",
    "  search QUERY  Search transactions and evidence",
    "  sync          Inspect or run a complete sync",
    "  doctor        Check configuration and backend access",
    "  tools         Print the machine-readable tool catalog",
    "  schema [TOOL] Print JSON Schema for one or all tools",
    "  mcp           Run the MCP stdio server",
    "",
    "Global options: --json --config PATH --base-url URL --timeout MS --profile NAME --help --version",
    "Authentication: KOBAN_API_TOKEN or the configured profile; tokens are never accepted as flags.",
    "",
    "Examples:",
    "  koban transactions list --account acct_123 --limit 20",
    "  koban transactions categorize txn_123 --category cat_food",
    "  koban transactions tag txn_123 --add trip --add work",
    "  koban sources import source_amazon_orders --file orders.json --dry-run",
    "  koban search 'conference hotel' --limit 8"
  ].join("\n");
}

export function helpFor(value) {
  const normalized = value.trim();
  if (!normalized) return rootHelp();
  if (normalized === "connectors" || /^connectors (list|status|add|setup|login|install|accounts)$/.test(normalized) || /^sources (add|setup|login|install)$/.test(normalized)) {
    return [
      "Set up evidence connectors on this machine.", "",
      "Usage: koban connectors <command> [SOURCE] [options]", "",
      "Commands:", "  list                    List supported connectors", "  accounts [SOURCE]       List registered mail profiles",
      "  status [SOURCE]         Check local credentials and backend imports",
      "  status [SOURCE] --verify Run bounded read-only live checks",
      "  setup SOURCE            Show missing steps without changing anything",
      "  add SOURCE              Install if missing, then log in interactively",
      "  install SOURCE          Install the connector's CLI",
      "  login SOURCE            Log in with the connector's supported flow", "",
      "Evidence sources: gmail, outlook, amazon, instacart, airbnb, shop, icloud",
      "Browser setup: plaid, snaptrade, simplefin, financekit", "",
      "Options: --profile NAME --email ADDRESS --label LABEL --password-file PATH (iCloud) --cookie-file PATH (Shop) --dry-run --json --config PATH --base-url URL", "",
      "Example: koban connectors add gmail --email you@example.com", "",
      "Login/install affect this machine. A remote backend needs setup on its own host.",
      "For Amazon, Instacart and Airbnb, sign in to the site in Chrome before running login."
    ].join("\n");
  }
  const utilities = {
    doctor: "koban doctor [--json]", tools: "koban tools [--json]",
    schema: "koban schema [TOOL]", mcp: "koban mcp", version: "koban --version"
  };
  if (utilities[normalized]) return `Usage: ${utilities[normalized]}\n\nGlobal options: --json --config PATH --base-url URL --timeout MS --profile NAME`;
  if (commandByPath.has(normalized)) return commandHelp(commandByPath.get(normalized));
  if (nouns.includes(normalized)) {
    const children = commands.filter(({ path: itemPath }) => itemPath.startsWith(`${normalized} `));
    return [`Usage: koban ${normalized} <command> [options]`, "", "Commands:", ...children.map(({ path: itemPath }) => `  ${itemPath.slice(normalized.length + 1)}`)].join("\n");
  }
  usageError(`Unknown help topic: ${normalized}`);
}

function command(commandPath, operation, positionals = [], options = {}) {
  return { aliases: {}, path: commandPath, operation, positionals, ...options };
}

function parseArguments(argv, definition, schema) {
  const args = {};
  const positionals = [];
  let file;
  let literal = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--" && !literal) { literal = true; continue; }
    if (literal || !token.startsWith("-")) { positionals.push(token); continue; }
    if (!token.startsWith("--")) usageError(`Unknown option: ${token}`);
    const [flag, inline] = splitOption(token);
    if (flag === "--file") {
      if (file !== undefined) usageError("--file may be supplied only once.");
      file = inline ?? requireOptionValue(argv, ++index, flag);
      continue;
    }
    const negated = flag.startsWith("--no-");
    const optionName = flag.slice(negated ? 5 : 2);
    const property = definition.aliases[optionName] ?? optionAliases[optionName] ?? optionName.replaceAll("-", "_");
    const propertySchema = schema.properties?.[property];
    if (!propertySchema) usageError(`Unknown option for ${definition.path}: ${flag}`);
    if (Object.hasOwn(args, property) && !schemaIncludes(propertySchema, "array")) usageError(`${flag} may be supplied only once.`);
    if (schemaIncludes(propertySchema, "boolean")) {
      let raw = inline;
      if (raw === undefined && ["true", "false"].includes(argv[index + 1])) raw = argv[++index];
      if (raw !== undefined && !["true", "false"].includes(raw)) usageError(`${flag} requires true or false.`);
      if (negated && raw !== undefined) usageError(`${flag} does not take a value.`);
      args[property] = negated ? false : raw === undefined ? true : raw === "true";
      continue;
    }
    if (negated) usageError(`${flag} is valid only for boolean options.`);
    const raw = inline ?? requireOptionValue(argv, ++index, flag);
    const converted = convertValue(raw, propertySchema, flag);
    if (schemaIncludes(propertySchema, "array")) args[property] = [...(args[property] ?? []), converted];
    else args[property] = converted;
  }
  for (const [index, property] of definition.positionals.entries()) {
    if (positionals[index] !== undefined) {
      if (Object.hasOwn(args, property)) usageError(`Supply ${property} either positionally or as a flag, not both.`);
      args[property] = positionals[index];
    }
  }
  return { args, file, positionals: positionals.slice(definition.positionals.length) };
}

function convertValue(raw, schema, option) {
  if (schemaIncludes(schema, "array")) return convertValue(raw, schema.items ?? {}, option);
  if (raw === "null" && schemaIncludes(schema, "null")) return null;
  if (schemaIncludes(schema, "integer") || schemaIncludes(schema, "number")) {
    const number = Number(raw);
    if (!raw.trim() || !Number.isFinite(number) || (schemaIncludes(schema, "integer") && !Number.isInteger(number))) {
      usageError(`${option} requires ${schemaIncludes(schema, "integer") ? "an integer" : "a number"}.`);
    }
    return number;
  }
  return raw;
}

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
async function applyFileInput(args, property, file, readStdin) {
  if (file === undefined) return;
  if (Object.hasOwn(args, property)) usageError(`Use either --${property.replaceAll("_", "-")} or --file, not both.`);
  let bytes;
  try {
    if (file === "-") bytes = Buffer.from(await readStdin());
    else {
      const handle = await open(file, "r");
      try {
        if (!(await handle.stat()).isFile()) usageError("Input must be a regular file.");
        if ((await handle.stat()).size > MAX_INPUT_BYTES) usageError("Input exceeds the 8 MiB limit.");
        bytes = await handle.readFile();
      } finally { await handle.close(); }
    }
  } catch (error) {
    if (error instanceof KobanClientError) throw error;
    usageError(`Unable to read input file: ${file}`);
  }
  if (bytes.length > MAX_INPUT_BYTES) usageError("Input exceeds the 8 MiB limit.");
  if (property === "content") {
    const filename = args.filename ?? (file !== "-" ? path.basename(file) : undefined);
    const encoding = args.content_encoding ?? (filename?.toLowerCase().endsWith(".zip") ? "base64" : "text");
    args.content = encoding === "base64" ? bytes.toString("base64") : bytes.toString("utf8");
    args.content_encoding = encoding;
    if (filename) args.filename = filename;
  } else args[property] = bytes.toString("utf8");
}

function commandHelp(definition) {
  const operation = operationByName.get(definition.operation);
  const properties = Object.entries(operation?.inputSchema.properties ?? {})
    .filter(([name]) => !definition.only || definition.only.includes(name));
  const required = new Set([...(operation?.inputSchema.required ?? []), ...(definition.required ?? [])]);
  const positional = definition.positionals.map((name) => name.toUpperCase()).join(" ");
  const options = properties.filter(([name]) => !definition.positionals.includes(name)).map(([name, schema]) => {
    const flag = `--${name.replaceAll("_", "-")}`;
    const aliases = Object.entries(optionAliases).filter(([, property]) => property === name).map(([alias]) => `--${alias}`);
    const type = schemaIncludes(schema, "array") ? "VALUE (repeatable)" : schema.enum ? schema.enum.join("|") : Array.isArray(schema.type) ? schema.type.join("|") : schema.type;
    const requirement = required.has(name)
      ? name === definition.fileProperty ? " (required unless --file is used)" : " (required)"
      : "";
    return `  ${[flag, ...aliases].join(", ")} ${schemaIncludes(schema, "boolean") ? `[true|false] / --no-${name.replaceAll("_", "-")}` : type}${requirement}`;
  });
  if (definition.fileProperty) options.push(`  --file PATH|-  Read ${definition.fileProperty} from a file or stdin (8 MiB maximum)`);
  const description = definition.path === "transactions categorize"
    ? "Assign an existing category to one transaction, preserving its other fields."
    : (operation?.description ?? definition.path).replaceAll("koban_modify_transaction_tags", "koban transactions tag");
  return [description, "", `Usage: koban ${definition.path}${positional ? ` ${positional}` : definition.variableSource ? " [SOURCE_ID]" : ""} [options]`, ...(options.length ? ["", "Options:", ...options] : []), "", "Global options: --json --config PATH --base-url URL --timeout MS --profile NAME"].join("\n");
}

function splitOption(token) {
  const equals = token.indexOf("=");
  return equals >= 0 && token.startsWith("--") ? [token.slice(0, equals), token.slice(equals + 1)] : [token, undefined];
}
function takesValue(token) {
  if (!token?.startsWith("--") || token.includes("=")) return false;
  if (token === "--file") return true;
  const name = token.slice(2);
  const property = optionAliases[name] ?? name.replaceAll("-", "_");
  return [...operationByName.values()].some(({ inputSchema }) => inputSchema.properties?.[property] && !schemaIncludes(inputSchema.properties[property], "boolean"));
}

function schemaIncludes(schema, type) {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type));
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined) usageError(`${option} requires a value.`);
  return value;
}

function usageError(message) {
  throw new KobanClientError(message, { code: "USAGE_ERROR" });
}

async function defaultReadStdin() {
  if (process.stdin.isTTY) usageError("--file - needs piped stdin.");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) usageError("Input exceeds the 8 MiB limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

const optionAliases = {
  account: "account_id",
  category: "category_id",
  source: "source_id",
  "source-item": "source_item_id",
  transaction: "transaction_id"
};
