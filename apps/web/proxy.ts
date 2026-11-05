import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateApiRequest,
  authCookieName,
  betterAuthBasePath,
  constantTimeTokenEquals,
  getBearerToken,
  getConfiguredAuthToken,
  isHostedAuthMode,
  loginPath
} from "@/lib/auth";
import {
  isPublicDemo,
  isPublicDemoEditAllowed,
  isPublicDemoEditCandidate,
  isPublicDemoRequestAllowed,
  publicDemoRefusalMessage,
  publicDemoRefusalStatus
} from "@/lib/public-demo";
import { hostFromHostHeader, isLoopbackHost } from "@/lib/loopback";
import { readWorkspaceEnv } from "@/lib/workspace-env";

const publicPaths = new Set([
  loginPath,
  "/privacy",
  "/api/health",
  "/api/login",
  "/api/auth/chatgpt/callback",
  "/api/auth/microsoft/callback",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml"
]);

export async function proxy(request: NextRequest) {
  const env = readWorkspaceEnv();
  const expectedToken = getConfiguredAuthToken(env);

  if (isPublicDemo(env)) {
    return await publicDemoResponse(request);
  }

  if (isPublicRequest(request)) {
    return NextResponse.next();
  }

  // Local open mode (no DATABASE_URL, no token) trusts whoever can reach the
  // port, so it answers only requests addressed to this machine. `next dev`
  // binds every interface by default; a LAN or DNS-rebinding request names
  // another host. The boot check in lib/config/AppConfig.ts covers production
  // binds; a hand-crafted Host header can still pass this one, so set
  // AI_FINANCES_AUTH_TOKEN whenever the port is reachable from other machines.
  if (!expectedToken && !isHostedAuthMode(env) && !isLoopbackRequest(request)) {
    return openModeRemoteRefusal(request);
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const authResult = await authenticateApiRequest(request, env);

    if (authResult.authenticated) {
      return NextResponse.next();
    }

    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (isHostedAuthMode(env)) {
    const authResult = await authenticateApiRequest(request, env);

    if (authResult.authenticated) {
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

async function publicDemoResponse(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (!isPublicDemoRequestAllowed(request.method, pathname)) {
    if (isPublicDemoEditCandidate(request.method, pathname)) {
      const body: unknown = await request.clone().json().catch(() => null);
      if (isPublicDemoEditAllowed(request.method, pathname, body)) {
        return NextResponse.next();
      }
    }
    return NextResponse.json(
      { error: publicDemoRefusalMessage(pathname, request.method) },
      { status: publicDemoRefusalStatus(request.method) }
    );
  }
  if (pathname === loginPath) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return NextResponse.next();
}

const openModeRemoteMessage =
  "This Koban server has no sign-in, so it only answers requests to localhost. Set AI_FINANCES_AUTH_TOKEN to use it from another machine.";

function isLoopbackRequest(request: NextRequest): boolean {
  const host = request.headers.get("host");
  return isLoopbackHost(host ? hostFromHostHeader(host) : request.nextUrl.hostname);
}

function openModeRemoteRefusal(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "local_only", message: openModeRemoteMessage, type: "permission_error" } },
      { status: 403 }
    );
  }
  return new NextResponse(openModeRemoteMessage, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
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
    "/api/:path*",
    "/((?!_next/static|_next/image|.*\\..*).*)"
  ]
};

function isPublicRequest(request: NextRequest): boolean {
  if (publicPaths.has(request.nextUrl.pathname)) {
    return true;
  }

  return request.nextUrl.pathname.startsWith("/_next/") || request.nextUrl.pathname.startsWith(`${betterAuthBasePath}/`);
}
