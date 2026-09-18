#!/usr/bin/env bash
# v205 browser E2E — server + agent-browser in ONE session (sandbox reaps
# background processes between tool calls).
set -u
cd /home/z/my-project
rm -f dev.log
setsid nohup npm run dev > /tmp/dev.log 2>&1 < /dev/null &
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://localhost:3000 2>/dev/null || echo 000)
  [ "$code" = "200" ] && break; sleep 3
done
echo "server=$code"

AB="agent-browser"
$AB close >/dev/null 2>&1 || true

echo "== 1. open home =="
$AB open http://localhost:3000 >/dev/null
$AB wait --load networkidle >/dev/null 2>&1
$AB snapshot -i 2>/dev/null | head -30

echo "== 2. search STIR 302678824 =="
REF=$($AB snapshot -i 2>/dev/null | rg -o '@e[0-9]+' | head -1)
# find the hero input by placeholder via find
$AB find placeholder "STIR raqamini kiriting…" fill "302678824" 2>/dev/null || $AB eval "
  const el = document.querySelector('.hero input');
  if (el) { el.value='302678824'; el.dispatchEvent(new Event('input',{bubbles:true})); }
  'filled'
"
$AB press Enter >/dev/null
sleep 2
$AB wait --load networkidle >/dev/null 2>&1
echo "url: $($AB get url)"

echo "== 3. go to Cases section (key 3) =="
$AB eval "window.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true})); 'ok'" >/dev/null
sleep 3
# wait for merged endpoint data
$AB eval "document.querySelectorAll('.lrow').length" 2>/dev/null | tail -1
$AB snapshot -i 2>/dev/null | rg -i "excel|pdf|sahifa|pager|Nomdan" | head -8
$AB screenshot /tmp/e2e-cases.png >/dev/null 2>&1

echo "== 4. page 2 via pager =="
$AB eval "
  const btns=[...document.querySelectorAll('a')].filter(a=>a.textContent.trim()==='2');
  if(btns.length){btns[0].click(); 'clicked'} else 'no-page2'
"
sleep 1
$AB eval "[...document.querySelectorAll('.lrow .mono')].slice(0,2).map(b=>b.textContent).join(' | ')" 2>/dev/null | tail -1

echo "== 5. seed watchlist via localStorage + open watchlist =="
$AB eval "
  const KEY='sud-registry-v1';
  const store={
    '302678824':{stir:'302678824',name:'MIS ISHLAB CHIQARISH',watched:true,meta:{}},
    '302049805':{stir:'302049805',name:'UZAVTOSANOAT',watched:true,meta:{}}
  };
  localStorage.setItem(KEY, JSON.stringify(store));
  location.reload(); 'seeded'
" >/dev/null
sleep 5
$AB wait --load networkidle >/dev/null 2>&1
$AB eval "window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true})); 'watchlist?'" >/dev/null
sleep 2
# navigate via rail button if exists
$AB eval "
  const b=[...document.querySelectorAll('button,a')].find(x=>/Kuzatuv/i.test(x.textContent||'') && !x.querySelector('h1'));
  if(b){b.click();'clicked'} else {'fallback'}
" 2>/dev/null | tail -1
sleep 3
echo "-- watchlist card metrics --"
$AB eval "
  const card=document.querySelector('.ccard');
  card ? [...card.querySelectorAll('.mini')].map(m=>m.textContent.replace(/\s+/g,' ').trim()).join(' | ') : 'NO-CARD'
" 2>/dev/null | tail -1
echo "-- refresh button present --"
$AB eval "document.querySelectorAll('.ccard .ccard-x').length" 2>/dev/null | tail -1
$AB screenshot /tmp/e2e-watchlist.png >/dev/null 2>&1

echo "== 6. settings workers tab =="
$AB eval "
  const b=[...document.querySelectorAll('button,a')].find(x=>/Sozlamalar/i.test(x.textContent||''));
  if(b){b.click();'ok'} else 'nf'
" >/dev/null
sleep 2
$AB eval "
  const t=[...document.querySelectorAll('button')].find(x=>/^Workers/i.test(x.textContent||'')||x.textContent.trim()==='Workers');
  if(t){t.click();'ok'} else 'nf'
" >/dev/null
sleep 2
$AB eval "document.querySelectorAll('.wrow, [class*=worker] li, table tr').length" 2>/dev/null | tail -1
$AB eval "
  const s=[...document.querySelectorAll('button')].find(x=>/Sinash/i.test(x.textContent||''));
  if(s){s.click();'clicked'} else 'no-sinash'
" 2>/dev/null | tail -1
sleep 6
echo "-- toast --"
$AB eval "[...document.querySelectorAll('[data-sonner-toast], .toast, li')].map(t=>t.textContent).filter(t=>/OK|ish|ms/i.test(t)).slice(0,2).join(' || ') || 'no-toast-text'" 2>/dev/null | tail -1
$AB screenshot /tmp/e2e-workers.png >/dev/null 2>&1

echo "== 7. page errors =="
$AB errors 2>/dev/null | head -6
echo "== done =="
$AB close >/dev/null 2>&1
