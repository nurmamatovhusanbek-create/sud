#!/usr/bin/env bash
# Probe jadvalapi.sud.uz/vka/{TYPE}/{courtId}/{YYYYMMDD} through a live CF worker.
# Goal: verify court ids per type + row shape before seeding crawler/court-list.ts
set -u
W="https://broad-field-f2b0.uzwebfox.workers.dev"
H=(-H 'Accept: application/json' -H 'Origin: https://jadval2.sud.uz' -H 'Referer: https://jadval2.sud.uz/'
   -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36')

probe() { # type id date
  local out code
  out=$(curl -s -m 20 -w '\n%{http_code}' "${H[@]}" "$W/https://jadvalapi.sud.uz/vka/$1/$2/$3")
  code=$(printf '%s' "$out" | tail -n1)
  local body; body=$(printf '%s' "$out" | head -n -1)
  local n=0
  if [ "$code" = "200" ]; then n=$(printf '%s' "$body" | rg -o '"casenumber"' | wc -l); fi
  echo "$1/$2/$3 -> $code rows:$n"
  if [ "$n" -gt 0 ]; then printf '%s' "$body" | head -c 600; echo; fi
}

echo "== Civil ids from court-map.ts, recent weekday =="
for id in andvilfsud andtfsud asaktfsud buxorovilfsud; do probe CIVIL "$id" 20260916; done

echo "== Economic pattern ids =="
for id in toshkent.t andijon.t samarqand.t fargona.t buxoro.t; do probe ECONOMIC "$id" 20260916; done

echo "== Administrative (CONFLICT) guesses =="
for id in toshkent.t toshkentsud; do probe CONFLICT "$id" 20260916; done

echo "== Same civil id across dates (0 rows vs data) =="
for d in 20260914 20260915 20260917 20260918; do probe CIVIL andtfsud "$d"; done
