import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SourceItemInput } from "@/lib/db/finance-db";
import { readWorkspaceEnv } from "@/lib/workspace-env";

// Shop's GraphQL endpoint only accepts its own allowlisted operations
// (OPERATION_NOT_ALLOWED), so this reads the route its order-history page posts to.
const shopEndpoint = "https://shop.app/web/api/order-history";
const shopOrderHistoryPage = "https://shop.app/account/order-history";
// Requests without a browser user agent are answered as UNAUTHORIZED.
const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const signedOutMessage = "Shop session is signed out. Sign in at https://shop.app/account/order-history in Chrome, then save the session again.";
const execFileAsync = promisify(execFile);
const maxResponseBytes = 2 * 1024 * 1024;
const pageSize = 25;
const defaultMaxPages = 10;
const defaultPageDelayMs = 1_500;
// Shop answers throttling with HTTP 429 or a GraphQL TOO_MANY_REQUESTS error
// and, as observed, no Retry-After header; the block outlasted 15 idle
// minutes. Retrying inside a sync only extends it, so a hit starts a cooldown
// that doubles on each consecutive hit and resets after a successful sync.
const baseRateLimitCooldownMs = 15 * 60_000;
const maxRateLimitCooldownMs = 6 * 60 * 60_000;

export class ShopSourceError extends Error {
  constructor(message: string, readonly code: "auth" | "config" | "malformed" | "network" | "rate_limited") {
    super(message);
    this.name = "ShopSourceError";
  }
}

export async function shopSessionStatus(): Promise<{ configured: boolean; source: "env" | "file" | "none" }> {
  try {
    const session = await readShopSession();
    return { configured: Boolean(session.cookie), source: session.source };
  } catch {
    return { configured: false, source: "file" };
  }
}

export async function saveShopSession(cookie: string): Promise<void> {
  const env = readWorkspaceEnv();
  if (cleanString(env.SHOP_COOKIE) || cleanString(env.SHOP_COOKIE_FILE)) {
    throw new ShopSourceError("Shop session is controlled by SHOP_COOKIE or SHOP_COOKIE_FILE; remove that override before saving.", "config");
  }
  const normalized = validateCookie(cookie);
  const sessionPath = shopSessionPath();
  await mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${sessionPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ cookie: normalized })}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, sessionPath);
  await chmod(sessionPath, 0o600);
  // A new session starts fresh rather than waiting out the previous one's cooldown.
  await clearRateLimitState();
}

export async function fetchShopSourceItems(options: {
  env?: Record<string, string>;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  now?: () => number;
  pageDelayMs?: number;
  signal?: AbortSignal;
} = {}): Promise<{ hasMore: boolean; items: SourceItemInput[] }> {
  const session = await readShopSession(options.env);
  if (!session.cookie) throw new ShopSourceError("Shop is not configured. Save a Shop session before syncing.", "auth");
  const now = options.now ?? Date.now;
  const cooldown = await readRateLimitState();
  if (cooldown && cooldown.until > now()) {
    throw new ShopSourceError(rateLimitMessage(cooldown.until), "rate_limited");
  }
  const maxPages = Math.min(Math.max(Math.trunc(options.maxPages ?? defaultMaxPages), 1), defaultMaxPages);
  const items = new Map<string, SourceItemInput>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let hasMore = false;

  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0) await pause(options.pageDelayMs ?? defaultPageDelayMs, options.signal);
    let payload: unknown;
    try {
      payload = await fetchShopPage(session.cookie, after, options);
    } catch (error) {
      if (error instanceof RateLimitedResponse) {
        const hits = (cooldown?.hits ?? 0) + 1;
        const waitMs = error.retryAfterMs ?? Math.min(baseRateLimitCooldownMs * 2 ** (hits - 1), maxRateLimitCooldownMs);
        const until = now() + waitMs;
        await writeRateLimitState({ hits, until });
        throw new ShopSourceError(rateLimitMessage(until), "rate_limited");
      }
      throw error;
    }
    const connection = extractConnection(payload);
    if (connection.nodes.length > pageSize) throw new ShopSourceError("Shop returned too many orders in one page.", "malformed");
    for (const item of normalizeShopOrders(payload)) items.set(item.externalId, item);
    const pageInfo = connection.pageInfo;
    if (typeof pageInfo.hasNextPage !== "boolean") throw new ShopSourceError("Shop returned malformed pagination state.", "malformed");
    hasMore = pageInfo.hasNextPage;
    if (!hasMore) break;
    const nextCursor = cleanString(pageInfo.endCursor);
    if (!nextCursor || cursors.has(nextCursor)) {
      throw new ShopSourceError("Shop pagination returned an invalid or repeated cursor.", "malformed");
    }
    cursors.add(nextCursor);
    after = nextCursor;
  }

  if (cooldown) await clearRateLimitState();
  return { hasMore, items: [...items.values()].slice(0, pageSize * defaultMaxPages) };
}

export function normalizeShopOrders(payload: unknown, sourceId = "source_shop_orders"): SourceItemInput[] {
  const records = extractOrders(payload);
  const seen = new Set<string>();
  return records.flatMap((value) => {
    const record = asRecord(value);
    if (!record) return [];
    const order = record.__typename === "Delivery" ? asRecord(record.order) : record;
    if (!order) return [];
    const externalId = cleanString(order.uuid) ?? cleanString(order.id);
    const occurredAt = validDate(cleanString(order.createdAt) ?? cleanString(order.placedAt));
    if (!externalId || !occurredAt || seen.has(externalId)) return [];
    seen.add(externalId);
    const shop = asRecord(order.shop);
    const merchantName = cleanString(shop?.name) ?? cleanString(order.merchant) ?? "Shop order";
    const price = asRecord(order.effectiveTotalPrice);
    const amount = finiteNumber(price?.amount ?? order.amount ?? parseTotal(order.total));
    const currency = cleanString(price?.currencyCode) ?? cleanString(order.currency) ?? parseCurrency(order.total);
    const lineItemConnection = asRecord(order.lineItems);
    const lineItems: unknown[] = Array.isArray(lineItemConnection?.nodes)
      ? lineItemConnection.nodes
      : Array.isArray(order.items) ? order.items : [];
    const itemDetails = lineItems.flatMap((item: unknown) => {
      const row = asRecord(item);
      const title = cleanString(row?.productTitle) ?? cleanString(row?.title);
      if (!title) return [];
      return [{
        lineTotal: finiteNumber(asRecord(row?.totalPrice)?.amount ?? row?.lineTotal),
        quantity: finiteNumber(row?.quantity ?? row?.qty),
        title,
        unitPrice: finiteNumber(asRecord(row?.unitPrice)?.amount ?? row?.unit)
      }];
    });
    const itemNames = itemDetails.map((item) => item.title);
    const status = cleanString(order.displayStatus) ?? cleanString(order.status);
    const summary = [
      `Order: ${externalId}`,
      status ? `Status: ${status}` : undefined,
      amount === undefined ? undefined : `Total: ${amount}${currency ? ` ${currency}` : ""}`,
      itemNames.length ? `Items: ${itemNames.slice(0, 8).join(", ")}` : undefined
    ].filter(Boolean).join(". ");
    return [{
      amount,
      currency: amount === undefined ? undefined : currency,
      externalId,
      id: `source_item_${createHash("sha256").update(`${sourceId}:${externalId}`).digest("hex").slice(0, 24)}`,
      kind: "order",
      merchantName,
      ...(itemDetails.length > 0
        ? {
            lines: itemDetails.map((item) => ({
              name: item.title,
              ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
              ...(item.unitPrice !== undefined ? { unitPrice: Math.abs(item.unitPrice) } : {}),
              ...(item.lineTotal !== undefined ? { amount: Math.abs(item.lineTotal) } : {})
            }))
          }
        : {}),
      metadata: { itemCount: finiteNumber(order.totalItemCount), items: itemDetails, status },
      occurredAt,
      sourceId,
      summary,
      title: `${merchantName} order`
    }];
  });
}

async function fetchShopPage(cookie: string, after: string | null, options: { fetchImpl?: typeof fetch; signal?: AbortSignal }) {
  const timeout = AbortSignal.timeout(10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? curlFetch)(shopEndpoint, {
      body: JSON.stringify({ pageSize: String(pageSize), ...(after ? { after } : {}) }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie,
        origin: "https://shop.app",
        referer: shopOrderHistoryPage,
        "user-agent": browserUserAgent
      },
      method: "POST",
      redirect: "error",
      signal
    });
  } catch {
    throw new ShopSourceError("Unable to reach Shop order history.", "network");
  }
  const text = await readBoundedText(response);
  if (response.status === 429 || isGraphqlRateLimit(text)) {
    throw new RateLimitedResponse(parseRetryAfterMs(response.headers.get("retry-after")));
  }
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { payload = undefined; }
  const record = asRecord(payload);
  if (record?.error === "UNAUTHORIZED") throw new ShopSourceError(signedOutMessage, "auth");
  if (response.status === 401 || response.status === 403 || /<html/i.test(text)) {
    throw new ShopSourceError("Shop session is not authorized for order history.", "auth");
  }
  if (!response.ok) throw new ShopSourceError(`Shop order history returned HTTP ${response.status}.`, "network");
  if (!record) throw new ShopSourceError("Shop returned malformed order history.", "malformed");
  if ((Array.isArray(record.errors) && record.errors.length) || cleanString(record.error)) throw new ShopSourceError("Shop rejected the order-history request.", "auth");
  extractConnection(payload);
  return payload;
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxResponseBytes) throw new ShopSourceError("Shop response exceeded the size limit.", "malformed");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxResponseBytes) { await reader.cancel(); throw new ShopSourceError("Shop response exceeded the size limit.", "malformed"); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

async function readShopSession(env = readWorkspaceEnv()): Promise<{ cookie?: string; source: "env" | "file" | "none" }> {
  const inline = cleanString(env.SHOP_COOKIE);
  if (inline) return { cookie: validateCookie(inline), source: "env" };
  const envFile = cleanString(env.SHOP_COOKIE_FILE);
  if (envFile) return { cookie: validateCookie(await safeRead(envFile)), source: "env" };
  try {
    const parsed = JSON.parse(await readFile(shopSessionPath(), "utf8"));
    return { cookie: validateCookie(parsed.cookie), source: "file" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { source: "none" };
    if (error instanceof ShopSourceError) throw error;
    throw new ShopSourceError("Shop session configuration is invalid.", "config");
  }
}

// Shop answers Node's HTTP clients (fetch and node:https alike) with
// UNAUTHORIZED for a session curl reads successfully with identical headers,
// so the request goes through curl. The config arrives on stdin to keep the
// cookie out of the process list.
async function curlFetch(url: string, init: { body: string; headers: Record<string, string>; signal: AbortSignal }): Promise<Response> {
  const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  const config = [
    `url = ${quote(url)}`,
    "request = POST",
    `data-raw = ${quote(init.body)}`,
    ...Object.entries(init.headers).map(([name, value]) => `header = ${quote(`${name}: ${value}`)}`)
  ].join("\n");
  const pending = execFileAsync("curl", [
    "--silent", "--show-error", "--proto", "=https", "--max-filesize", String(maxResponseBytes),
    "--config", "-", "--write-out", "%{stderr}%{http_code}\n%header{retry-after}"
  ], { encoding: "utf8", maxBuffer: maxResponseBytes + 4096, signal: init.signal });
  pending.child.stdin?.end(config);
  const { stdout, stderr } = await pending;
  const [status, retryAfter] = stderr.trim().split("\n");
  return new Response(stdout, { headers: retryAfter ? { "retry-after": retryAfter } : {}, status: Number(status) });
}

class RateLimitedResponse extends Error {
  constructor(readonly retryAfterMs: number | undefined) {
    super("Shop rate limited the request.");
  }
}

function isGraphqlRateLimit(text: string): boolean {
  try {
    const errors = asRecord(JSON.parse(text))?.errors;
    return Array.isArray(errors) && errors.some((error) => asRecord(asRecord(error)?.extensions)?.code === "TOO_MANY_REQUESTS");
  } catch {
    return false;
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, maxRateLimitCooldownMs) : undefined;
}

function rateLimitMessage(until: number): string {
  return `Shop is rate limiting order-history requests; the next attempt is held until ${new Date(until).toISOString()}.`;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

async function readRateLimitState(): Promise<{ hits: number; until: number } | undefined> {
  try {
    const parsed = asRecord(JSON.parse(await readFile(rateLimitStatePath(), "utf8")));
    const hits = finiteNumber(parsed?.hits);
    const until = finiteNumber(parsed?.until);
    return hits !== undefined && until !== undefined ? { hits, until } : undefined;
  } catch {
    return undefined;
  }
}

async function writeRateLimitState(state: { hits: number; until: number }): Promise<void> {
  const statePath = rateLimitStatePath();
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporaryPath, statePath);
}

async function clearRateLimitState(): Promise<void> {
  await rm(rateLimitStatePath(), { force: true });
}

function rateLimitStatePath() { return path.join(os.homedir(), ".config", "koban", "shop-rate-limit.json"); }
function shopSessionPath() { return path.join(os.homedir(), ".config", "koban", "shop-session.json"); }
async function safeRead(file: string) { try { return await readFile(file, "utf8"); } catch { throw new ShopSourceError("Unable to read SHOP_COOKIE_FILE.", "config"); } }
function validateCookie(value: unknown) { const cookie = cleanString(value); if (!cookie || cookie.length > 32_768 || !cookie.includes("=") || /[\u0000-\u001f\u007f]/.test(cookie)) throw new ShopSourceError("Shop cookie is invalid.", "config"); return cookie; }
function extractConnection(payload: unknown): { nodes: unknown[]; pageInfo: Record<string, unknown> } { const root = asRecord(payload); const connection = asRecord(root?.deliveriesOrdersList) ?? asRecord(asRecord(root?.data)?.deliveriesOrdersList); if (!connection || !Array.isArray(connection.nodes) || !asRecord(connection.pageInfo)) throw new ShopSourceError("Shop returned malformed order history.", "malformed"); return { nodes: connection.nodes, pageInfo: asRecord(connection.pageInfo)! }; }
function extractOrders(payload: unknown): unknown[] { const root = asRecord(payload); if (Array.isArray(root?.orders)) return root.orders; try { return extractConnection(payload).nodes; } catch { return Array.isArray(payload) ? payload : []; } }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function cleanString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function finiteNumber(value: unknown) { const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(number) ? number : undefined; }
function validDate(value?: string) { if (!value || !Number.isFinite(Date.parse(value))) return undefined; return new Date(value).toISOString(); }
function parseTotal(value: unknown) { const match = typeof value === "string" ? value.match(/-?\d+(?:\.\d+)?/) : undefined; return match?.[0]; }
function parseCurrency(value: unknown) { const match = typeof value === "string" ? value.match(/\b[A-Z]{3}\b/) : undefined; return match?.[0]; }
