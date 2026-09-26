import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
