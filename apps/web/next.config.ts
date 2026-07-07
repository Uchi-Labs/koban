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
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' https://cdn.teller.io",
      "connect-src 'self' https://api.teller.io https://*.teller.io",
      "frame-src https://*.teller.io",
      "upgrade-insecure-requests"
    ].join("; ")
  }
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  },
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite"],
  transpilePackages: [
    "@ai-finances/schema",
    "@ai-finances/sync-protocol"
  ]
};

export default nextConfig;
