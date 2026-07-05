import { NextResponse, type NextRequest } from "next/server";
import { authCookieName, getConfiguredAuthToken, loginPath } from "@/lib/auth";
import { timingSafeTokenEquals } from "@/lib/auth-node";

export const runtime = "nodejs";

const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

export async function POST(request: NextRequest) {
  const expectedToken = getConfiguredAuthToken();

  if (!expectedToken) {
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  }

  const login = await readLoginRequest(request);

  if (!timingSafeTokenEquals(login.token, expectedToken)) {
    if (login.wantsJson) {
      return NextResponse.json({ error: "Invalid token." }, { status: 401 });
    }

    return redirectToLogin(request, login.nextPath, true);
  }

  const response = login.wantsJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL(safeNextPath(login.nextPath), request.url), { status: 303 });

  response.cookies.set({
    name: authCookieName,
    value: expectedToken,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });

  return response;
}

async function readLoginRequest(request: NextRequest): Promise<{
  nextPath: string | undefined;
  token: string | undefined;
  wantsJson: boolean;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  const wantsJson = contentType.includes("application/json") || request.headers.get("accept")?.includes("application/json") === true;

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({})) as { next?: unknown; token?: unknown };
    return {
      nextPath: typeof body.next === "string" ? body.next : undefined,
      token: typeof body.token === "string" ? body.token : undefined,
      wantsJson
    };
  }

  const formData = await request.formData().catch(() => new FormData());
  const token = formData.get("token");
  const nextPath = formData.get("next");

  return {
    nextPath: typeof nextPath === "string" ? nextPath : undefined,
    token: typeof token === "string" ? token : undefined,
    wantsJson
  };
}

function redirectToLogin(request: NextRequest, nextPath: string | undefined, invalid: boolean) {
  const loginUrl = new URL(loginPath, request.url);
  const safeNext = safeNextPath(nextPath);

  if (safeNext !== "/") {
    loginUrl.searchParams.set("next", safeNext);
  }

  if (invalid) {
    loginUrl.searchParams.set("error", "1");
  }

  return NextResponse.redirect(loginUrl, { status: 303 });
}

function safeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  try {
    const url = new URL(value, "http://ai-finances.local");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
