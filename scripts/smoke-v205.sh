#!/usr/bin/env bash
# Start dev server, wait ready, smoke the v205 endpoints, keep or kill.
set -u
cd /home/z/my-project
rm -f dev.log
setsid nohup npm run dev > /tmp/dev.log 2>&1 < /dev/null &
SRV=$!
ready=0
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://localhost:3000 2>/dev/null || echo 000)
  [ "$code" = "200" ] && { ready=1; break; }
  sleep 3
done
echo "READY=$ready (root=$code)"

echo "== 1. settings/workers (fresh install -> 4 defaults) =="
curl -s -m 90 "http://localhost:3000/api/settings/workers" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('source:', d['source'], '| count:', len(d['workers']))
for w in d['workers']: print(' -', w['url'])
" || echo "WORKERS-FAIL"

echo "== 2. admin/crawl (no DATABASE_URL -> 501 skipped) =="
curl -s -m 90 -X POST "http://localhost:3000/api/admin/crawl" -w ' [%{http_code}]'; echo

echo "== 3. workers/test (live probe of default worker) =="
curl -s -m 90 -X POST "http://localhost:3000/api/settings/workers/test" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://broad-field-f2b0.uzwebfox.workers.dev/"}'; echo

echo "== 4. company-cases (STIR 302678824, DB-free => TIN-only + partial[]) =="
curl -s -m 120 "http://localhost:3000/api/company-cases?tin=302678824" | python3 -c "
import json,sys
d=json.load(sys.stdin)
data=d.get('data',d)
cases=data.get('cases',[])
partial=data.get('partial',[])
srcs={}
for c in cases: srcs[c.get('source','?')]=srcs.get(c.get('source','?'),0)+1
types={}
for c in cases: types[c.get('courtType','?')]=types.get(c.get('courtType','?'),0)+1
print('ok:', d.get('ok'), '| cases:', len(cases), '| by source:', srcs, '| by type:', types, '| partial:', partial)
" || echo "COMPANY-CASES-FAIL"

echo "== 5. court-cases/export -> xlsx =="
curl -s -m 120 "http://localhost:3000/api/court-cases/export?tin=302678824" -o /tmp/cases-export.xlsx -w '[%{http_code}] '
file /tmp/cases-export.xlsx | head -1

echo "== 6. upcoming-hearings/export -> xlsx =="
curl -s -m 120 "http://localhost:3000/api/upcoming-hearings/export?tin=302678824" -o /tmp/hearings-export.xlsx -w '[%{http_code}] '
file /tmp/hearings-export.xlsx | head -1
