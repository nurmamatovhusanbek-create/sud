#!/usr/bin/env bash
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
$AB open http://localhost:3000 >/dev/null
$AB wait --load networkidle >/dev/null 2>&1

$AB eval "
  (function(){
    const el=document.querySelector('.hero input, input[placeholder*=\"STIR\"]');
    if(el){const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,'302678824');el.dispatchEvent(new Event('input',{bubbles:true}));}
    return 'ok';
  })()
" >/dev/null
$AB press Enter >/dev/null
sleep 5
$AB eval "
  (function(){
    const b=[...document.querySelectorAll('button')].find(x=>/ochish/i.test(x.textContent||'')&&!x.disabled);
    if(b){b.click();return 'opened'} return 'nf'
  })()
" 2>/dev/null | tail -1
sleep 2
$AB eval "window.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));'k3'" >/dev/null
echo "== waiting up to 60s for merged case rows =="
ROWS=0
for i in $(seq 1 20); do
  sleep 3
  ROWS=$($AB eval "document.querySelectorAll('.p-card .lrow').length" 2>/dev/null | tail -1 | tr -d '"')
  [ "$ROWS" -gt 10 ] 2>/dev/null && break
done
echo "rows=$ROWS"
$AB eval "
  (function(){
    const pager=[...document.querySelectorAll('a,button')].filter(x=>x.textContent.trim()==='2' && x.closest('nav,[class*=pag]'));
    return pager.length ? 'pager-present-with-page2' : 'pager=' + (document.querySelector('nav,[class*=pag]')?'present':'absent');
  })()
" 2>/dev/null | tail -1
$AB eval "[...document.querySelectorAll('.lrow .mono')].slice(0,3).map(x=>x.textContent.trim()).join(' | ')" 2>/dev/null | tail -1
$AB eval "
  (function(){
    const nomdan=[...document.querySelectorAll('.lrow')].filter(x=>/Nomdan topildi/.test(x.textContent||''));
    return 'nomdan-badged-rows=' + nomdan.length;
  })()
" 2>/dev/null | tail -1
$AB screenshot /tmp/e2e3-cases.png >/dev/null 2>&1

echo "== Settings > Workers > Sinash =="
$AB eval "
  (function(){
    const b=[...document.querySelectorAll('button')].find(x=>/Sozlamalar/i.test(x.textContent||''));
    if(b){b.click();return 'ok'} return 'nf'
  })()
" 2>/dev/null | tail -1
sleep 3
$AB find text "Sinash" click 2>&1 | tail -1
sleep 9
$AB eval "
  (function(){
    const t=[...document.querySelectorAll('[data-sonner-toast]')].map(x=>x.textContent.trim());
    const wrow=document.body.textContent.includes('So\u2018nggi test: OK')||document.body.textContent.includes("So'nggi test: OK");
    return 'toast='+(t.length?t.join(' || '):'none')+' ; lasttest-ok='+wrow;
  })()
" 2>/dev/null | tail -1
$AB screenshot /tmp/e2e3-workers.png >/dev/null 2>&1
$AB errors 2>/dev/null | head -4
$AB close >/dev/null 2>&1
echo DONE
