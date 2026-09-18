#!/bin/bash
# Probe all court-case upstream endpoints for a TIN, count results per endpoint
TIN="${1:-200248856}"
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

count() {
  local label="$1" url="$2"
  local body http
  http=$(curl -sS -o /tmp/probe_body.json -w '%{http_code}' --max-time 25 \
    -H "User-Agent: $UA" -H 'Accept: application/json, text/plain, */*' \
    -H 'Origin: https://my.sud.uz' -H 'Referer: https://my.sud.uz/' \
    "$url" 2>/tmp/probe_err.txt)
  local size=$(wc -c < /tmp/probe_body.json)
  # count items: try jq, fallback to regex on casenumber
  local n
  n=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('/tmp/probe_body.json','utf8'));
      const arr = Array.isArray(d) ? d : (d.data || d.result || []);
      console.log(Array.isArray(arr) ? arr.length : 'obj:' + Object.keys(d).slice(0,6).join(','));
    } catch(e) { console.log('parse-fail'); }
  " 2>/dev/null)
  echo "$label => HTTP $http, ${size}B, items=$n $([ -s /tmp/probe_err.txt ] && echo "(err: $(cat /tmp/probe_err.txt | head -1))")"
}

echo "=== TIN $TIN — jadvalapi.sud.uz (newer API) ==="
count "ECONOMIC/findByTin " "https://jadvalapi.sud.uz/online-monitoring/ECONOMIC/findByTin/$TIN"
count "CIVIL/findByTin    " "https://jadvalapi.sud.uz/online-monitoring/CIVIL/findByTin/$TIN"
count "CONFLICT/findByTin " "https://jadvalapi.sud.uz/online-monitoring/CONFLICT/findByTin/$TIN"
count "CRIMINAL/findByTin " "https://jadvalapi.sud.uz/online-monitoring/CRIMINAL/findByTin/$TIN"
count "ADM/findByTin      " "https://jadvalapi.sud.uz/online-monitoring/ADMIN/findByTin/$TIN"
count "MATERIAL/findByTin " "https://jadvalapi.sud.uz/online-monitoring/MATERIAL/findByTin/$TIN"
echo ""
echo "=== TIN $TIN — jadval.sud.uz (older API) ==="
count "case/findByTin     " "https://jadval.sud.uz/case/findByTin/$TIN"
