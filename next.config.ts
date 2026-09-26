import type { NextConfig } from "next";

// ---- Security headers ------------------------------------------------------
// The whole client is same-origin (API on /api, fonts self-hosted by
// next/font, no external scripts/images), so the CSP can be tight. In dev,
// Turbopack HMR needs eval + a websocket, so those are allowed only there.
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

// Applied to every response. This is a private, single-operator tool that
// serves scraped company/court data, so: no framing (clickjacking), no MIME
// sniffing, a tight referrer policy, no powerful browser features, and a
// noindex tag so it never lands in a search index if ever exposed.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Security headers on all routes; API responses additionally never cache
  // (they carry sensitive scraped data that must not sit in a shared cache).
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
  // P0 (rebuild blueprint): type errors are NO LONGER suppressed. The build now
  // enforces types so upstream-shape drift and loose API typing surface at build
  // time instead of shipping silent bad data. Run `bun run typecheck` to see the
  // current backlog. If a deploy is genuinely blocked mid-migration, fix the
  // offending file — do not re-enable ignoreBuildErrors.
  typescript: {
    ignoreBuildErrors: false,
  },
  // reactStrictMode: false — still disabled. Re-enable only AFTER the data layer
  // adds request de-duplication / in-flight coalescing (blueprint P4), so strict
  // mode's double-invoke doesn't double real upstream scrapes. Tracked, not forgotten.
  reactStrictMode: false,
  // Dev-only: the Next.js dev indicator defaults to bottom-left, directly on top
  // of the sidebar theme-toggle button (.side-foot), which makes that button
  // unclickable while running `bun run dev`. Move it out of the way. No effect on
  // the production standalone build.
  devIndicators: {
    position: "bottom-right",
  },
  // The document engine reads the .docx templates from the filesystem at
  // request time. Trace them into the standalone build so the route can find
  // them in production (dev reads straight from the project tree).
  outputFileTracingIncludes: {
    "/api/documents/generate": ["./src/lib/documents/templates/*.docx"],
    "/api/pretenzia/generate": [
      "./src/lib/documents/templates/pretenzia.docx",
      "./src/lib/documents/templates/talabnoma-uz.docx",
    ],
  },
};

export default nextConfig;
