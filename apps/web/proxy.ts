import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateApiRequest,
  authCookieName,
  betterAuthBasePath,
  constantTimeTokenEquals,
  getBearerToken,
  getConfiguredAuthToken,
  hasBetterAuthSessionCookie,
  isHostedAuthMode,
  loginPath
} from "@/lib/auth";

const publicPaths = new Set([
  loginPath,
  "/privacy",
  "/api/health",
  "/api/login",
  "/api/auth/chatgpt/callback",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml"
]);

export async function proxy(request: NextRequest) {
  const expectedToken = getConfiguredAuthToken();

  if (isPublicRequest(request)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const authResult = await authenticateApiRequest(request);

    if (authResult.authenticated) {
      return NextResponse.next();
    }

    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (isHostedAuthMode()) {
    if (hasBetterAuthSessionCookie(request)) {
      return NextResponse.next();
    }

    return redirectToLogin(request);
  }

  if (!expectedToken) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(authCookieName)?.value;
  const bearerToken = getBearerToken(request.headers.get("authorization"));

  if (
    constantTimeTokenEquals(sessionToken, expectedToken) ||
    constantTimeTokenEquals(bearerToken, expectedToken)
  ) {
    return NextResponse.next();
  }

  return redirectToLogin(request);
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = loginPath;
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\..*).*)"
  ]
};

function isPublicRequest(request: NextRequest): boolean {
  if (publicPaths.has(request.nextUrl.pathname)) {
    return true;
  }

  return request.nextUrl.pathname.startsWith("/_next/") || request.nextUrl.pathname.startsWith(`${betterAuthBasePath}/`);
}
