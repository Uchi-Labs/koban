import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { KobanClientError } from "./client.js";

export async function readShopCookieFile(filename) {
  let handle;
  try {
    handle = await open(filename, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 32_768) throw new Error("invalid file");
    const text = (await handle.readFile("utf8")).trim();
    if (text.startsWith("[") || text.startsWith("{")) {
      const parsed = JSON.parse(text);
      if (typeof parsed.cookie === "string") return validateCookie(parsed.cookie);
      const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;
      if (!Array.isArray(cookies)) throw new Error("invalid cookie export");
      return validateCookie(cookies.filter((cookie) => typeof cookie.domain === "string" && cookie.domain.replace(/^\./, "") === "shop.app")
        .map((cookie) => {
          if (typeof cookie.name !== "string" || typeof cookie.value !== "string" || /[;=\s]/.test(cookie.name) || /[;\r\n\0]/.test(cookie.value)) throw new Error("invalid cookie");
          return `${cookie.name}=${cookie.value}`;
        }).join("; "));
    }
    return validateCookie(text.replace(/^Cookie:\s*/i, ""));
  } catch {
    throw new KobanClientError("Cannot read a valid Shop session file. Supply a Cookie header or shop.app cookie JSON export (maximum 32 KiB).", { code: "USAGE_ERROR" });
  } finally { await handle?.close(); }
}

// Reads shop.app cookies straight from Chrome's store, including HttpOnly ones
// a pasted document.cookie misses. Values are never printed.
export async function readShopCookieFromChrome({ run = promisify(execFile) } = {}) {
  let stdout;
  try {
    ({ stdout } = await run("pycookiecheat", ["https://shop.app"], { timeout: 30_000, maxBuffer: 1024 * 1024 }));
  } catch (error) {
    const missing = error?.code === "ENOENT";
    throw new KobanClientError(missing
      ? "Reading Chrome cookies needs pycookiecheat. Install it (uv tool install pycookiecheat) or use --cookie-file PATH."
      : "Could not read shop.app cookies from Chrome. Sign in at https://shop.app in Chrome, then retry.", { code: "USAGE_ERROR" });
  }
  let cookies;
  try { cookies = JSON.parse(stdout); } catch { cookies = undefined; }
  const pairs = cookies && typeof cookies === "object" && !Array.isArray(cookies) ? Object.entries(cookies).filter(([name, value]) => name && typeof value === "string") : [];
  if (!pairs.length) throw new KobanClientError("Chrome has no shop.app cookies. Sign in at https://shop.app in Chrome, then retry.", { code: "USAGE_ERROR" });
  return validateCookie(pairs.map(([name, value]) => `${name}=${value}`).join("; "));
}

function validateCookie(cookie) {
  const value = cookie.trim();
  if (!value || !value.includes("=") || value.length > 32_768 || /[\r\n\0]/.test(value)) throw new Error("invalid cookie");
  return value;
}

export async function requestShopSession(configuration, { cookie, verify = false, fetchImpl = fetch } = {}) {
  const url = new URL(`api/v1/sources/source_shop_orders/session${verify ? "?verify=true" : ""}`, `${configuration.baseUrl}/`);
  try {
    const response = await fetchImpl(url, {
      method: cookie === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", ...(cookie === undefined ? {} : { "content-type": "application/json" }), ...(configuration.token ? { authorization: `Bearer ${configuration.token}` } : {}) },
      ...(cookie === undefined ? {} : { body: JSON.stringify({ cookie }) })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty response");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) { await reader.cancel(); throw new Error("response too large"); }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return {
      configured: result.configured === true,
      live_access: ["verified", "failed", "not_checked"].includes(result.live_access) ? result.live_access : "not_checked",
      ...(Number.isInteger(result.items_seen) ? { items_seen: result.items_seen } : {}),
      ...(typeof result.has_more === "boolean" ? { has_more: result.has_more } : {})
    };
  } catch {
    throw new KobanClientError("Shop session request failed. Check backend access and session configuration. No session value was logged.", { code: "SHOP_SESSION_ERROR" });
  }
}
