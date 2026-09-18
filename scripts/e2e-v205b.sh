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

echo "== seed STIR company + open workspace =="
$AB eval "
  (function(){
    const el = document.querySelector('.hero input, input[placeholder*=\"STIR\"]');
    if (el) { const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,'302678824'); el.dispatchEvent(new Event('input',{bubbles:true})); }
    return 'filled';
  })()
" >/dev/null
$AB press Enter >/dev/null
sleep 4
$AB eval "
  (function(){
    const b=[...document.querySelectorAll('button')].find(x=>/Ochish|Ochish|Очиш|^Ochish$/i.test((x.textContent||'').trim()));
    if(b&&!b.disabled){b.click();return 'opened'}
    return 'still-disabled'
  })()
" 2>/dev/null | tail -1
sleep 2

echo "== Cases: rows + pager =="
$AB eval "
  (function(){
    const b=[...document.querySelectorAll('button')].find(x=>/Ishlari|Sud ishlari|Cases/i.test(x.textContent||'')) ||
            [...document.querySelectorAll('[role=tablist] button, .tabs button')].find(x=>x.textContent.trim()==='3');
    return b ? 'tab-found' : 'using-key';
  })()
" >/dev/null
$AB eval "window.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));'k3'" >/dev/null
sleep 6
$AB eval "document.querySelectorAll('.lrow').length + ' rows; badge-nomdan=' + document.querySelectorAll('.badge, [class*=badge]').length" 2>/dev/null | tail -1
$AB eval "
  (function(){
    const pagerLinks=[...document.querySelectorAll('a')].filter(a=>a.textContent.trim()==='2' && a.closest('[class*=pagination], nav, .pager'));
    if(pagerLinks.length){pagerLinks[0].click(); return 'page2-clicked'}
    return 'single-page-only (' + document.querySelectorAll('.lrow').length + ' rows, pagerTotal=' + (document.querySelector('[class*=pagination], nav') ? 'present' : 'absent') + ')';
  })()
" 2>/dev/null | tail -1
$AB eval "[...document.querySelectorAll('.lrow .mono')].slice(0,2).map(x=>x.textContent.trim()).join(' | ')" 2>/dev/null | tail -1
$AB screenshot /tmp/e2e2-cases.png >/dev/null 2>&1

echo "== Settings > Workers =="
$AB eval "
  (function(){
    const b=[...document.querySelectorAll('button')].find(x=>/Sozlamalar/i.test(x.textContent||''));
    if(b){b.click();return 'opened'} return 'nf'
  })()
" 2>/dev/null | tail -1
sleep 2
$AB eval "
  (function(){
    const t=[...document.querySelectorAll('button')].find(x=>/Workers/i.test(x.textContent||''));
    if(t){t.click();return 'tab'} return 'nf'
  })()
" 2>/dev/null | tail -1
sleep 3
$AB eval "
  (function(){
    const rows=[...document.querySelectorAll('[class*=wrow], [class*=worker-row], [class*=row]')].filter(r=>/workers\\.dev/.test(r.textContent||''));
    return rows.length + ' worker rows: ' + rows.slice(0,5).map(r=>(r.textContent.match(/https:\\/\\/[a-z0-9-]+\\./)||[''])[0]).join(', ');
  })()
" 2>/dev/null | tail -1
$AB eval "
  (function(){
    const s=[...document.querySelectorAll('button')].find(x=>/Sinash/i.test(x.textContent||''));
    if(s){s.click();return 'testing'} return 'no-btn'
  })()
" 2>/dev/null | tail -1
sleep 8
$AB eval "
  (function(){
    const toasts=[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.textContent.trim());
    return toasts.length ? toasts.join(' || ') : 'no-toast';
  })()
" 2>/dev/null | tail -1
$AB screenshot /tmp/e2e2-workers.png >/dev/null 2>&1

echo "== errors =="
$AB errors 2>/dev/null | head -4
$AB close >/dev/null 2>&1
echo DONE
