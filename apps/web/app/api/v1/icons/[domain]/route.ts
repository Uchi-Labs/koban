import { NextResponse } from "next/server";
import { isIconDomainAllowed } from "@/lib/merchant-domain";

export const runtime = "nodejs";

/**
 * Serves brand favicons from this origin so the browser never asks a third
 * party for them.
 *
 * Fetching favicons directly from google/ddg in the page meant the request set
 * leaked the user's entire banking roster to that provider, from the user's own
 * IP (SEC-03) -- which is why lib/merchant-domain.ts carried no bank domains at
 * all. Routing through here removes the leak: the browser only ever talks to
 * us, and the upstream sees this server asking about a domain, with no user
 * attached and no way to tie several lookups to one person.
 *
 * There is no SSRF surface. The upstream host is a constant; the domain travels
 * as a query parameter and is never used to choose what to connect to. The
 * allowlist is a second, independent limit: it keeps an authenticated caller
 * from using this as a general-purpose image fetcher.
 *
 * Auth is inherited. proxy.ts authenticates every /api/* request before it gets
 * here, and a same-origin <img> sends the session cookie, so logos load for a
 * signed-in user and 401 for anyone else.
 */

/** RFC 1123 host: labels of alphanumerics and hyphens, at least two of them. */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const ICON_SIZE = 64;
const UPSTREAM_TIMEOUT_MS = 5_000;

/** A day in the browser, a month on any shared cache. Brand marks rarely move. */
const CACHE_CONTROL = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";

/**
 * A 1x1 transparent GIF, returned when every upstream fails.
 *
 * Deliberately a 200 rather than a 404: FaviconBadge treats an image error as
 * "this brand has no mark" and falls back to its tinted initial, which is the
 * right end state, but a 404 per uncached miss also fills the console with
 * noise on every page load. The transparent pixel reaches the same fallback
 * quietly, because it decodes yet renders nothing.
 */
const EMPTY_PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function upstreamCandidates(domain: string): string[] {
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${ICON_SIZE}`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
  ];
}

async function fetchIcon(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // No cookies, no referrer: nothing about this deployment or its user
      // should ride along to the icon provider.
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer"
    });

    if (!response.ok) {
      return null;
    }

    const type = response.headers.get("content-type") ?? "";
    return type.startsWith("image/") ? response : null;
  } catch {
    // Timeout, DNS failure, upstream outage. The next candidate gets a turn.
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ domain: string }> }) {
  const domain = decodeURIComponent((await params).domain)
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");

  if (!HOSTNAME.test(domain) || domain.length > 253) {
    return NextResponse.json({ error: "Malformed domain." }, { status: 400 });
  }

  if (!isIconDomainAllowed(domain)) {
    return NextResponse.json(
      { error: "Domain is not in the icon allowlist." },
      { status: 404 }
    );
  }

  for (const candidate of upstreamCandidates(domain)) {
    const response = await fetchIcon(candidate);

    if (response) {
      return new NextResponse(await response.arrayBuffer(), {
        headers: {
          "cache-control": CACHE_CONTROL,
          "content-type": response.headers.get("content-type") ?? "image/png",
          // The upstream is an implementation detail and naming it in a header
          // would hand it straight back to the client we hid it from.
          "x-content-type-options": "nosniff"
        }
      });
    }
  }

  return new NextResponse(EMPTY_PIXEL, {
    headers: {
      // Short: an upstream outage should not pin an empty icon for a day.
      "cache-control": "public, max-age=600",
      "content-type": "image/gif",
      "x-content-type-options": "nosniff"
    }
  });
}
