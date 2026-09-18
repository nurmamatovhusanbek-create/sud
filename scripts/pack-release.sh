#!/bin/bash
# Pack the rebuilt Sud Billing Lookup system into one versioned zip.
set -e
cd /home/z/my-project
VER="v205"
OUT="download/sud-billing-lookup-${VER}.zip"
STAGE=$(mktemp -d)/sud-billing-lookup-${VER}
mkdir -p "$STAGE"

# Source tree + config (no node_modules/.next/logs/screenshots)
rsync -a \
  --exclude 'node_modules' --exclude '.next' --exclude 'dev.log' --exclude 'server.log' \
  --exclude '.git' --exclude 'download' --exclude 'upload' --exclude 'tool-results' \
  --exclude 'sud-billing-lookup' --exclude '.z-ai-config' --exclude '*.db' \
  --exclude 'examples' --exclude 'Caddyfile' --exclude 'components.json' \
  src public scripts mini-services cloudflare-worker tests docs migrations \
  package.json bun.lock tsconfig.json next.config.ts tailwind.config.ts \
  postcss.config.mjs eslint.config.mjs .env.example worklog.md instrumentation.ts \
  "$STAGE"/ 2>/dev/null || true

# Restore the two files the broad rsync call may have skipped
mkdir -p "$STAGE/src" "$STAGE/public" "$STAGE/scripts" "$STAGE/mini-services" "$STAGE/cloudflare-worker" "$STAGE/tests" "$STAGE/migrations"
cp -r src/. "$STAGE/src/"
cp -r public/. "$STAGE/public/"
cp -r scripts/. "$STAGE/scripts/"
cp -r mini-services/. "$STAGE/mini-services/"
cp -r cloudflare-worker/. "$STAGE/cloudflare-worker/"
cp -r tests/. "$STAGE/tests/" 2>/dev/null || true
cp -r migrations/. "$STAGE/migrations/"
cp package.json bun.lock tsconfig.json next.config.ts tailwind.config.ts postcss.config.mjs eslint.config.mjs .env.example worklog.md instrumentation.ts "$STAGE"/
# v205: delivery docs live in the repo root now
cp README-DELIVERY.md "$STAGE/README-DELIVERY.md" 2>/dev/null || true
cp P0-RUNBOOK.md "$STAGE/P0-RUNBOOK.md" 2>/dev/null || true

mkdir -p download
rm -f "$OUT"
( cd "$(dirname "$STAGE")" && zip -qr /home/z/my-project/"$OUT" "sud-billing-lookup-${VER}" )
echo "Packed: $OUT"
unzip -l "$OUT" | tail -3
