import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv";
import { operations } from "./catalog.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:3007";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SYNC_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 1_200_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LONG_RUNNING_OPERATIONS = new Set([
  "koban_run_sync",
  "koban_sync_source",
  "koban_sync_sources"
]);

const ajv = new Ajv({ allErrors: true, strict: false });
const operationsByName = new Map();

for (const operation of operations) {
  if (operationsByName.has(operation.name)) {
    throw new Error(`Duplicate operation name: ${operation.name}`);
  }

  operationsByName.set(operation.name, {
    operation,
    validate: ajv.compile(operation.inputSchema)
  });
}

export class KobanClientError extends Error {
  constructor(message, { code = "CLIENT_ERROR", status } = {}) {
    super(message);
    this.name = "KobanClientError";
    this.code = code;
    this.status = status;
  }
}

export function listOperations() {
  return operations.map(({ description, inputSchema, name, readOnly }) => ({
    description,
    inputSchema,
    name,
    readOnly
  }));
}

export async function resolveConfiguration({ env = process.env, homeDir = os.homedir() } = {}) {
  const explicitConfigPath = cleanString(env.KOBAN_CONFIG);
  const configDisabled = explicitConfigPath === "none";
  const configPath = configDisabled
    ? undefined
    : explicitConfigPath
    ? expandHome(explicitConfigPath, homeDir)
    : path.join(homeDir, ".config", "koban", "config.json");
  const config = configDisabled
    ? {}
    : await readConfig(configPath, { required: Boolean(explicitConfigPath) });
  const configBaseUrl = normalizeBaseUrl(cleanString(config.baseUrl) ?? DEFAULT_BASE_URL);
  const baseUrl = normalizeBaseUrl(cleanString(env.KOBAN_BASE_URL) ?? configBaseUrl);
  const environmentTokenPresent = Object.hasOwn(env, "KOBAN_API_TOKEN");
  const environmentToken = cleanString(env.KOBAN_API_TOKEN);
  const configToken = cleanString(config.token);
  const token = environmentTokenPresent
    ? environmentToken
    : sameOrigin(baseUrl, configBaseUrl)
      ? configToken
      : undefined;
  const timeoutMs = parseTimeoutMs(
    Object.hasOwn(env, "KOBAN_TIMEOUT_MS") ? env.KOBAN_TIMEOUT_MS : config.timeoutMs
  );

  return {
    baseUrl,
    configPath,
    token,
    tokenSource: environmentToken
      ? "environment"
      : token && configToken
        ? "config"
        : "none",
    timeoutMs
  };
}

export async function executeOperation(name, args = {}, options = {}) {
  const entry = operationsByName.get(name);
  if (!entry) {
    throw new KobanClientError(`Unknown tool: ${name}`, { code: "UNKNOWN_TOOL" });
  }

  if (!entry.validate(args)) {
    throw new KobanClientError(formatValidationErrors(entry.validate.errors), {
      code: "INVALID_ARGUMENTS"
    });
  }

  const resolvedConfiguration = options.configuration ?? await resolveConfiguration(options);
  const configuration = {
    ...resolvedConfiguration,
    baseUrl: normalizeBaseUrl(resolvedConfiguration.baseUrl),
    token: cleanString(resolvedConfiguration.token)
  };
  const request = entry.operation.request(args);
  const url = buildRequestUrl(configuration.baseUrl, request);
  const controller = new AbortController();
  const timeoutMs = parseTimeoutMs(options.timeoutMs
    ?? configuration.timeoutMs
    ?? (LONG_RUNNING_OPERATIONS.has(name) ? DEFAULT_SYNC_TIMEOUT_MS : DEFAULT_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      headers: {
        accept: "application/json",
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        ...(configuration.token ? { authorization: `Bearer ${configuration.token}` } : {})
      },
      method: request.method,
      redirect: "error",
      signal
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new KobanClientError(httpErrorMessage(response.status, payload, configuration.token), {
        code: "HTTP_ERROR",
        status: response.status
      });
    }

    return payload;
  } catch (error) {
    if (error instanceof KobanClientError) {
      throw error;
    }
    if (signal.aborted) {
      const message = entry.operation.readOnly
        ? "Koban backend request timed out or was cancelled."
        : "Koban backend write timed out or was cancelled. Its outcome may be unknown; do not automatically retry.";
      throw new KobanClientError(message, {
        code: "REQUEST_ABORTED"
      });
    }
    throw new KobanClientError("Unable to reach the Koban backend.", {
      code: "NETWORK_ERROR"
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readConfig(configPath, { required }) {
  let contents;
  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      return {};
    }
    throw new KobanClientError("Unable to read Koban configuration.", { code: "CONFIG_ERROR" });
  }

  try {
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("configuration must be an object");
    }
    if (parsed.token !== undefined && typeof parsed.token !== "string") {
      throw new Error("token must be a string");
    }
    if (parsed.baseUrl !== undefined && typeof parsed.baseUrl !== "string") {
      throw new Error("baseUrl must be a string");
    }
    if (parsed.timeoutMs !== undefined && typeof parsed.timeoutMs !== "number") {
      throw new Error("timeoutMs must be a number");
    }
    return parsed;
  } catch {
    throw new KobanClientError("Koban configuration is not valid JSON configuration.", {
      code: "CONFIG_ERROR"
    });
  }
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new KobanClientError("Koban baseUrl must be a valid HTTP URL.", { code: "CONFIG_ERROR" });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new KobanClientError("Koban baseUrl must be an HTTP URL without embedded credentials.", {
      code: "CONFIG_ERROR"
    });
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new KobanClientError("Plain HTTP Koban URLs are allowed only on the loopback host.", {
      code: "CONFIG_ERROR"
    });
  }
  url.hash = "";
  url.search = "";
  return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
}

function sameOrigin(left, right) {
  return new URL(left).origin === new URL(right).origin;
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseTimeoutMs(value) {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new KobanClientError(`Koban timeout must be an integer from 1 to ${MAX_TIMEOUT_MS} milliseconds.`, {
      code: "CONFIG_ERROR"
    });
  }
  return parsed;
}

function buildRequestUrl(baseUrl, request) {
  const base = new URL(`${baseUrl}/`);
  const requestPath = typeof request.path === "string" && request.path.startsWith("/")
    ? request.path.slice(1)
    : request.path;
  const url = new URL(requestPath, base);
  if (url.origin !== base.origin) {
    throw new KobanClientError("Tool request must stay on the configured Koban backend.", {
      code: "INVALID_REQUEST"
    });
  }
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJsonResponse(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new KobanClientError("Koban backend response exceeded the size limit.", {
      code: "RESPONSE_TOO_LARGE"
    });
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new KobanClientError("Koban backend response exceeded the size limit.", {
        code: "RESPONSE_TOO_LARGE"
      });
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new KobanClientError("Koban backend returned invalid JSON.", {
      code: "INVALID_RESPONSE"
    });
  }
}

function httpErrorMessage(status, payload, token) {
  const detail = cleanString(payload?.error) ?? cleanString(payload?.message);
  return detail
    ? `Koban backend returned HTTP ${status}: ${safeErrorDetail(detail, token)}`
    : `Koban backend returned HTTP ${status}.`;
}

function safeErrorDetail(value, token) {
  const redacted = token ? value.split(token).join("[REDACTED]") : value;
  return redacted.slice(0, 300).replace(/[\u0000-\u001f\u007f]/g, " ");
}

function formatValidationErrors(errors) {
  const details = (errors ?? []).slice(0, 5).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "is invalid"}`;
  });
  return `Invalid tool arguments${details.length ? `: ${details.join("; ")}` : "."}`;
}

function expandHome(value, homeDir) {
  return value === "~" ? homeDir : value.startsWith("~/") ? path.join(homeDir, value.slice(2)) : value;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
