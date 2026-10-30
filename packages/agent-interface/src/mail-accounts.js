import { open } from "node:fs/promises";
import { KobanClientError } from "./client.js";

export function mailSourceId(provider, profile) {
  profile = typeof profile === "string" ? profile.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(profile)) throw new KobanClientError("--profile must be a name of up to 63 letters, digits, underscores or hyphens.", { code: "USAGE_ERROR" });
  const prefix = { gmail: "source_gmail", outlook: "source_outlook_email", icloud: "source_icloud_mail" }[provider];
  if (!prefix) throw new KobanClientError("Named mail profiles support gmail, outlook and icloud.", { code: "USAGE_ERROR" });
  return `${prefix}__${profile}`;
}

export async function readAppPasswordFile(filename) {
  let file;
  try {
    file = await open(filename, "r");
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 1024) throw new Error();
    const password = (await file.readFile("utf8")).trim();
    if (!password || password.length > 256 || /\s/.test(password)) throw new Error();
    return password;
  } catch { throw new KobanClientError("Cannot read the app-specific password file. Use a private text file containing only the password.", { code: "USAGE_ERROR" }); }
  finally { await file?.close(); }
}

export async function requestMailAccounts(configuration, { id, account, fetchImpl = fetch } = {}) {
  const url = new URL("api/v1/mail-accounts", `${configuration.baseUrl}/`);
  if (id) url.searchParams.set("id", id);
  try {
    const response = await fetchImpl(url, {
      method: account ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", ...(account ? { "content-type": "application/json" } : {}), ...(configuration.token ? { authorization: `Bearer ${configuration.token}` } : {}) },
      ...(account ? { body: JSON.stringify(account) } : {})
    });
    if (!response.ok) throw new KobanClientError(response.status === 409 ? "That profile is already bound to another mailbox. Choose a new profile." : `Mail account request returned HTTP ${response.status}.`, { code: "MAIL_ACCOUNT_ERROR", status: response.status });
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 131072) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const safe = (value) => Object.fromEntries(["id", "provider", "profile", "email", "label", "auth_config_path"].filter((key) => typeof value?.[key] === "string").map((key) => [key, value[key]]));
    return Array.isArray(body.data) ? { data: body.data.map(safe) } : safe(body);
  } catch (error) {
    if (error instanceof KobanClientError) throw error;
    throw new KobanClientError("Unable to reach the mail account registry. No credentials were logged.", { code: "MAIL_ACCOUNT_ERROR" });
  }
}

export async function verifyMailAccount(configuration, id) {
  try {
    const response = await fetch(new URL(`api/v1/mail-accounts/${encodeURIComponent(id)}/verify`, `${configuration.baseUrl}/`), {
      headers: configuration.token ? { authorization: `Bearer ${configuration.token}` } : {},
      redirect: "error", signal: AbortSignal.timeout(35_000)
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    return { configured: result.configured === true, live_access: ["verified", "failed", "not_checked"].includes(result.live_access) ? result.live_access : "not_checked" };
  } catch { throw new KobanClientError("Mail access could not be verified. No credentials were logged.", { code: "MAIL_ACCOUNT_ERROR" }); }
}
