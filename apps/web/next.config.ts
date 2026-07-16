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
      "img-src 'self' data: blob: https://www.google.com https://icons.duckduckgo.com",
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
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
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
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  transpilePackages: [
    "@ai-finances/schema",
    "@ai-finances/sync-protocol"
  ]
};

export default nextConfig;
