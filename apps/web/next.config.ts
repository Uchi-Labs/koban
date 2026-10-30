import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains"
  },
  {
    // Enforced, but ONLY the upgrade directive: rewrites any http:// subresource
    // to https:// before the request is made. It never blocks, so it can't break
    // legitimate cross-origin calls (the full restrictive policy stays report-only
    // below until its violation reports are clean). This clears Chrome's mixed-
    // content "Not Secure" downgrade on the authenticated app.
    key: "Content-Security-Policy",
    value: "upgrade-insecure-requests"
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      // Brand icons are fetched server-side by /api/v1/icons and served from
      // this origin, so the favicon providers no longer need to be listed. The
      // page requesting them directly was both a privacy leak (SEC-03) and a
      // standing violation, since google.com/s2/favicons redirects to
      // t*.gstatic.com, which was never on this list.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://cdn.plaid.com https://s3.tradingview.com",
      "connect-src 'self' https://*.plaid.com https://*.tradingview.com wss://*.tradingview.com",
      "frame-src https://cdn.plaid.com https://*.tradingview.com",
      "upgrade-insecure-requests"
    ].join("; ")
  }
];

const nextConfig: NextConfig = {
  // Dev-only: hosts other than localhost (e.g. a Tailscale name) must be listed
  // or `next dev` blocks its scripts and the page never hydrates.
  allowedDevOrigins: (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Lets a <Link unstable_dynamicOnHover> upgrade its prefetch from the
    // loading skeleton to the full page data on hover/touch-start. Every route
    // here is dynamic, so the default viewport prefetch can only ever cache the
    // loading.tsx shell; the hover upgrade fetches the real payload during the
    // ~100ms between pointing at a sidebar item and clicking it, so the page is
    // usually already in the router cache by the time the click lands. Only the
    // sidebar opts in, so this never fans out to every link on a page.
    dynamicOnHover: true,
    // Client router cache: repeat navigations to a recently visited route
    // render instantly from cache (data staleness bounded at 30s; sync cadence
    // is 30m/daily, and ledger writes invalidate server caches anyway).
    staleTimes: {
      dynamic: 30,
      static: 180
    }
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  },
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "ai-sdk-provider-claude-code", "pg"],
  transpilePackages: [
    "@ai-finances/schema",
    "@ai-finances/sync-protocol"
  ]
};

export default nextConfig;
