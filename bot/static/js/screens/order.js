// One court order: what the backup knows about it, «Botga yuborish» (the bot sends the PDF to this chat) or, when the file was never downloaded, «Yuklash»
// (asks the app, through the bot↔app link, to download it). The order is found among its case's orders, so the screen also lists the case's other instances.
import { h } from '../ui/h.js'
import { Button, Card, Hero, Kv, List, Row, SectionLabel } from '../ui/components.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { dmy } from '../core/format.js'
import { d } from '../core/text.js'
import { courtName, TopBar } from './common.js'
import { orderRow } from './orders.js'

/** a button that runs one request, shows what is happening and what came of it in the line under it (the person never presses twice) */
function Action({ label, busy, run }) {
  const note = h('p', { class: 'muted small hint', role: 'status', 'aria-live': 'polite' })
  const btn = Button({ label, block: true, variant: 'primary', onClick: async () => {
    if (btn.disabled) return
    btn.disabled = true
    note.textContent = busy
    try {
      const done = await run()
      note.textContent = done.message
      if (done.again) btn.disabled = false
    } catch (e) {
      note.textContent = e.message || 'Bajarilmadi'
      btn.disabled = false
    }
  } })
  return h('div', { class: 'stack' }, btn, note)
}

export async function orderScreen(route, { signal }) {
  const { orders: set } = await api.orders({ case: route.case }, { signal })
  const o = set.rows.find((x) => x.pdfId === route.key)
  if (!o) return h('div', { class: 'screen stack' }, TopBar(), Card({}, h('p', { class: 'muted small' }, 'Bu qaror zaxirada topilmadi. Zaxira yangilangan boʻlishi mumkin.')))
  const others = set.rows.filter((x) => x.pdfId !== o.pdfId)
  const action = o.saved
    ? Action({ label: 'Botga yuborish', busy: 'Yuborilmoqda…', run: async () => { await api.ordersSend(o.pdfId, { signal }); return { message: 'Qaror botning chatiga yuborildi: Telegramda botni oching.', again: true } } })
    : Action({ label: 'Yuklash', busy: 'Soʻralmoqda…', run: async () => { const r = await api.ordersDownload(o.pdfId, { signal }); return { message: r.message, again: r.status === 'saved' || r.status === 'full' || r.status === 'too_many' || r.status === 'not_linked' } } })
  return h('div', { class: 'screen stack' },
    TopBar(Button({ label: 'Ish ›', size: 'small', onClick: () => go({ name: 'case', key: o.caseNumber }) })),
    Hero({ caption: `${o.instanceWord} · ${courtName(o.courtType)} ish`, id: o.caseNumber, line: o.resultWord || 'Natija maʼlum emas' }),
    Card({ title: o.saved ? 'Qaror fayli' : 'Qaror topilgan, fayl yuklanmagan' },
      Kv('Sud', d(o.court)), Kv('Sudya', d(o.judge)), Kv('Turkum', d(o.category)), Kv('Natija', o.resultWord),
      o.saved && Kv('Hajmi', o.sizeLabel, { raw: true }), o.saved && o.savedAt > 1e11 && Kv('Yuklangan', dmy(o.savedAt), { raw: true }),
      action),
    !o.saved && h('p', { class: 'muted small hint' }, 'Sud saytidan yuklashni ilova bajaradi (u yoqilgan va botga ulangan boʻlishi kerak). Yuklangach, zaxiraga tushadi va shu yerda «Botga yuborish» chiqadi.'),
    others.length > 0 && [SectionLabel(`Shu ishning boshqa qarorlari (${others.length})`), List(...others.map((x) => orderRow(x, { withCase: false })))])
}
