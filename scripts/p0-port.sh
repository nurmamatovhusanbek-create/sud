#!/usr/bin/env bash
# P0: Port the sud-billing-lookup source into the live project.
# Excludes: secrets (.z-ai-config), Prisma, dead weight, old UI monolith, giant docs.
set -euo pipefail
SRC=/home/z/my-project/sud-billing-lookup
DST=/home/z/my-project

# --- Scraper libs + infra libs (VERBATIM — the crown jewels) ---
mkdir -p $DST/src/lib
for f in billing.ts court-case.ts court-case-types.ts court-map.ts orginfo.ts mib.ts \
         chamber.ts jadval2.ts stats.ts cf-worker-pool.ts workers-config.ts \
         health-registry.ts tor.ts cache.ts local-lists.ts version.ts version-server.ts; do
  cp "$SRC/src/lib/$f" "$DST/src/lib/$f"
done
# utils.ts: keep scaffold's (it has cn()); the repo's is identical shadcn cn.

# --- API routes (ported as baseline; rebuilt on the new middleware in P4) ---
rm -rf $DST/src/app/api
mkdir -p $DST/src/app/api
cp -r $SRC/src/app/api/* $DST/src/app/api/
# Delete the scaffold "hello world" route per blueprint §3.10
rm -f $DST/src/app/api/route.ts

# --- Custom components (settings + ui-custom + shared) — ported for reuse/restyle ---
rm -rf $DST/src/components/settings $DST/src/components/ui-custom $DST/src/components/shared
mkdir -p $DST/src/components
cp -r $SRC/src/components/settings  $DST/src/components/settings
cp -r $SRC/src/components/ui-custom $DST/src/components/ui-custom
cp -r $SRC/src/components/shared    $DST/src/components/shared

# --- Cloudflare worker (kept, deployed separately) ---
mkdir -p $DST/cloudflare-worker
cp $SRC/cloudflare-worker/proxy.js $DST/cloudflare-worker/proxy.js

# --- Mini-services: tor-manager as-is; ihamkor-scraper WITHOUT ~20 test files ---
rm -rf $DST/mini-services
mkdir -p $DST/mini-services
cp -r $SRC/mini-services/tor-manager $DST/mini-services/tor-manager
mkdir -p $DST/mini-services/ihamkor-scraper
for f in $(ls $SRC/mini-services/ihamkor-scraper | grep -v '^test-'); do
  cp -r "$SRC/mini-services/ihamkor-scraper/$f" "$DST/mini-services/ihamkor-scraper/$f"
done

# --- Public assets ---
cp $SRC/public/logo.svg $DST/public/logo.svg 2>/dev/null || true

# --- Untrack the leaked credential in the reference clone (P0 A2) ---
cd $SRC
git rm --cached .z-ai-config >/dev/null 2>&1 || true

echo "PORT COMPLETE"
