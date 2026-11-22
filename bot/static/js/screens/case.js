import { h } from '../ui/h.js'
import { Button, Card, Kv, List, Row, SectionLabel, Timeline } from '../ui/components.js'
import { BillStatus, billWord, CourtStatus } from '../ui/status.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { has, money } from '../core/format.js'
import { d } from '../core/prefs.js'
import { courtName, TopBar } from './common.js'

const INSTANCE = { first: '1-instansiya', appellate: 'Apellyatsiya', cassation: 'Kassatsiya', inspection: 'Taftish' }

function hearing(x) {
  return [h('div', {}, h('b', { class: 'mono' }, x.date || ''), ' ', x.time || ''),
    h('div', {}, CourtStatus(x.status)),
    has(x.postponementReason) && h('div', { class: 'muted small' }, 'Sabab: ', d(x.postponementReason)),
    has(x.courtroom) && h('div', { class: 'muted small' }, 'Zal: ', d(x.courtroom))]
}

function instance(title, ins) {
  if (!ins || typeof ins !== 'object') return null
  const dec = ins.decision && typeof ins.decision === 'object' ? ins.decision : null
  const docs = ins.documents || []
  return Card({ title },
    Kv('Sud', ins.court), Kv('Sudya', ins.judge), Kv('Shikoyat qiluvchi', ins.appellant),
    (ins.hearings || []).length > 0 && Timeline(ins.hearings.map(hearing)),
    dec && h('div', { class: 'stack' }, h('div', { class: 'section-label' }, 'Qaror'),
      Kv('Sana', dec.date), Kv('Natija', dec.text || dec.type), Kv('Undirilgan summa', dec.awardedAmount), Kv('Davlat boji', dec.stateDutyRecovered), Kv('Ijro sanasi', dec.enforcedDate), Kv('Apellyatsiya muddati', dec.appealDeadline)),
    docs.length > 0 && h('div', {}, h('div', { class: 'section-label' }, `Hujjatlar (${docs.length})`), ...docs.slice(0, 20).map((x) => Kv(x.date || x.type || '', x.name || x.title || x.type || ''))))
}

export async function caseScreen(route, { signal }) {
  const { case: c } = await api.caseOf(route.key, { signal })
  const detail = c.detail || {}
  const g = detail.general
  const row = c.row
  const status = g?.caseStatus || row?.status
  const bills = c.bills || []
  const total = bills.reduce((a, b) => a + (Number(b.amount) || 0), 0)
  const copy = Button({ label: 'Nusxa', size: 'small', onClick: async () => { try { await navigator.clipboard.writeText(c.num); copy.textContent = 'Nusxalandi' } catch { /* not allowed here */ } } })

  return h('div', { class: 'screen stack' },
    TopBar(Button({ label: `STIR ${c.tin} ›`, size: 'small', onClick: () => go({ name: 'company', key: c.tin }) })),
    Card({}, h('div', { class: 'split' }, h('p', { class: 'card__id mono' }, c.num), copy), h('div', { class: 'screen__lead' }, `${courtName(c.court)} · 20${c.year} yilda roʻyxatga olingan`),
      status && h('div', { class: 'screen__status' }, CourtStatus(status))),
    g ? [
      Card({ title: 'Umumiy' }, Kv('Turi', g.caseType), Kv('Daʼvo predmeti', g.claimSubject), Kv('Sud', g.court), Kv('Hudud', g.region), Kv('Sudya', g.judge), Kv('Kotib', g.secretary), Kv('Joriy instansiya', INSTANCE[g.currentInstance] || g.currentInstance), Kv('Daʼvo summasi', g.claimAmount), Kv('Davlat boji', g.stateDuty), Kv('Ariza sanasi', g.applicationDate), Kv('Ish qoʻzgatilgan', g.initiatedDate), Kv('Muddat', g.deadlineDate)),
      Card({ title: 'Tomonlar' }, Kv('Daʼvogar', g.plaintiff), Kv('Daʼvogar STIR', g.plaintiffTin), Kv('Javobgar', g.defendant), Kv('Javobgar STIR', g.defendantTin), Kv('Uchinchi shaxs', g.thirdParty), Kv('Vakil', g.representative), Kv('Prokuror', g.prosecutor)),
    ] : row
      ? Card({ title: 'Umumiy' }, Kv('Sud', row.court), Kv('Daʼvogar', row.plaintiff), Kv('Javobgar', row.defendant), Kv('Holati', row.status))
      : Card({}, h('p', { class: 'muted small' }, 'Batafsil maʼlumot zaxirada yoʻq: bu ish faqat kvitansiyalar orqali maʼlum. Ilovada kompaniya ishlari yangilanganda zaxiraga tushadi.')),
    instance('1-instansiya', detail.firstInstance), instance('Apellyatsiya', detail.appellate), instance('Kassatsiya', detail.cassation), instance('Taftish', detail.inspection),
    bills.length > 0 && [SectionLabel(`Kvitansiyalar (${bills.length}) · jami ${money(total)}`),
      List(...bills.map((b) => Row({ icon: 'bill', title: b.number, sub: `${d(b.cat)} · ${money(b.amount)} · ${billWord(b.status)}`, onOpen: () => go({ name: 'bill', key: b.number }) })))])
}
