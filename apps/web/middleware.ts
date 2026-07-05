import { NextResponse, type NextRequest } from "next/server";
import { authCookieName, constantTimeTokenEquals, getBearerToken, getConfiguredAuthToken, loginPath } from "@/lib/auth";

const publicPaths = new Set([
  loginPath,
  "/api/health",
  "/api/login",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml"
]);

export function middleware(request: NextRequest) {
  const expectedToken = getConfiguredAuthToken();

  if (!expectedToken || isPublicRequest(request)) {
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

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

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

  return request.nextUrl.pathname.startsWith("/_next/");
}
