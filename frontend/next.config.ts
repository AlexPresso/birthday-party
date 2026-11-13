import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { uploadProxyBodyLimit } from "./runtime/upload-limits.ts";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: frontendRoot,
  turbopack: { root: frontendRoot },
  poweredByHeader: false,
  // The development indicator overlaps the first mobile navigation tab.
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: uploadProxyBodyLimit(),
    proxyTimeout: 600000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL || "http://127.0.0.1:8080"}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Font files keep stable names (see public/fonts/SOURCE.md), so they
        // are cached for a year without `immutable`: a replaced file is still
        // picked up when the browser revalidates.
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000" }],
      },
      {
        // App icons may be redrawn under the same names: a day of caching,
        // then a background refresh for up to a week.
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
