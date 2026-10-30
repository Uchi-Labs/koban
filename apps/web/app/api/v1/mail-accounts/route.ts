import { NextResponse } from "next/server";
import { getMailAccount, listMailAccounts, MailAccountError, outlookConfigPath, saveMailAccount } from "@/lib/mail-accounts";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };

function serialize(account: Awaited<ReturnType<typeof saveMailAccount>>) {
  return { ...account, object: "mail_account", ...(account.provider === "outlook" ? { auth_config_path: outlookConfigPath(account) } : {}) };
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const account = await getMailAccount(id);
    return account ? NextResponse.json(serialize(account), { headers }) : NextResponse.json({ error: "Mail account not found." }, { status: 404, headers });
  }
  return NextResponse.json({ object: "list", data: (await listMailAccounts()).map(serialize), has_more: false }, { headers });
}

export async function POST(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Account details are required." }, { status: 400, headers });
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); return NextResponse.json({ error: "Account input is too large." }, { status: 413, headers }); }
    chunks.push(value);
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Account details must be a JSON object." }, { status: 400, headers }); }
  if ((body.provider !== "gmail" && body.provider !== "outlook" && body.provider !== "icloud") || typeof body.profile !== "string" || typeof body.email !== "string" ||
      (body.label !== undefined && typeof body.label !== "string") || (body.app_password !== undefined && typeof body.app_password !== "string") ||
      Object.keys(body).some((key) => !["provider", "profile", "email", "label", "app_password"].includes(key))) {
    return NextResponse.json({ error: "Provide provider, profile, email and optional label/app_password." }, { status: 400, headers });
  }
  try {
    const account = await saveMailAccount({ provider: body.provider, profile: body.profile, email: body.email, label: body.label, appPassword: body.app_password });
    return NextResponse.json(serialize(account), { status: 201, headers });
  } catch (error) {
    const conflict = error instanceof MailAccountError && error.code === "conflict";
    return NextResponse.json({ error: conflict ? "This profile is already bound to another mailbox. Choose a new profile." : "Unable to save this mail profile. Check the account details and private registry permissions." }, { status: conflict ? 409 : 400, headers });
  }
}
