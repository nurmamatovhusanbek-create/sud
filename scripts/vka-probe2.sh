#!/usr/bin/env bash
# Complete the vka court-id map: economic (.t) + administrative (CONFLICT) across
# all candidate regional ids, using future weekday 2026-09-21 (Monday).
set -u
W="https://broad-field-f2b0.uzwebfox.workers.dev"
D=21092026
H=(-H 'Accept: application/json' -H 'Origin: https://jadval2.sud.uz' -H 'User-Agent: Mozilla/5.0')
IDS="toshkent.t toshkent.v andijon.t samarqand.t samarqand.v fargona.t buxoro.t jizzax.t xorezm.t urganch.t navoiy.t qashqadaryo.t qarshi.t sirdaryo.t guliston.t surxondaryo.t termiz.t qoraqalpogiston.t nukus.t namangan.t"
echo "== ECONOMIC =="
for id in $IDS; do
  n=$(curl -s -m 20 "${H[@]}" "$W/https://jadvalapi.sud.uz/vka/ECONOMIC/$id/$D" | rg -o '"casenumber"' | wc -l)
  [ "$n" -gt 0 ] && echo "ECONOMIC/$id rows:$n" &
done; wait
echo "== CONFLICT =="
for id in $IDS; do
  n=$(curl -s -m 20 "${H[@]}" "$W/https://jadvalapi.sud.uz/vka/CONFLICT/$id/$D" | rg -o '"casenumber"' | wc -l)
  [ "$n" -gt 0 ] && echo "CONFLICT/$id rows:$n" &
done; wait
echo "== CIVIL spot-check (non court-map id sanity) =="
for id in toshkent.t; do
  n=$(curl -s -m 20 "${H[@]}" "$W/https://jadvalapi.sud.uz/vka/CIVIL/$id/$D" | rg -o '"casenumber"' | wc -l)
  echo "CIVIL/$id rows:$n"
done
