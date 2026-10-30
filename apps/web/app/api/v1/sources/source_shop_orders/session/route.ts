import { NextResponse } from "next/server";
import { fetchShopSourceItems, saveShopSession, shopSessionStatus } from "@/lib/shop-source";
import { invalidateSourceAdapterProbes } from "@/lib/source-adapters";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const session = await shopSessionStatus();
  const result = {
    object: "source_session", source_id: "source_shop_orders", configured: session.configured,
    experimental: true, live_access: "not_checked"
  };
  if (!session.configured || new URL(request.url).searchParams.get("verify") !== "true") {
    return NextResponse.json(result, { headers });
  }
  try {
    const response = await fetchShopSourceItems({ maxPages: 1, signal: request.signal });
    return NextResponse.json({ ...result, live_access: "verified", items_seen: response.items.length, has_more: response.hasMore }, { headers });
  } catch {
    return NextResponse.json({ ...result, live_access: "failed", error: "Shop access could not be verified. The session may have expired or the experimental endpoint may have changed." }, { headers });
  }
}

export async function POST(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "A Shop cookie is required." }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) {
      await reader.cancel();
      return NextResponse.json({ error: "Shop session input is too large." }, { status: 413, headers });
    }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return NextResponse.json({ error: "Session input must be JSON." }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || !("cookie" in body) || typeof body.cookie !== "string" || !body.cookie.trim()) {
    return NextResponse.json({ error: "A Shop cookie is required." }, { status: 400, headers });
  }
  if (/[\r\n\0]/.test(body.cookie) || body.cookie.length > 32_768 || !body.cookie.includes("=")) {
    return NextResponse.json({ error: "Shop cookie format is invalid." }, { status: 400, headers });
  }
  try { await saveShopSession(body.cookie.trim()); }
  catch {
    return NextResponse.json({ error: "Shop session could not be saved. Check the backend session-file permissions and any SHOP_COOKIE overrides." }, { status: 409, headers });
  }
  invalidateSourceAdapterProbes();
  return NextResponse.json({ object: "source_session", source_id: "source_shop_orders", configured: true, live_access: "not_checked" }, { headers });
}
