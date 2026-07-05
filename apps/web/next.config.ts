import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite"],
  transpilePackages: [
    "@ai-finances/schema",
    "@ai-finances/sync-protocol"
  ]
};

export default nextConfig;
