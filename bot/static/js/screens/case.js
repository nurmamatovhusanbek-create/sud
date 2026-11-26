import { h } from '../ui/h.js'
import { Button, Callout, Card, Hero, Kv, List, Parties, Row, SectionLabel, Tabs, Timeline } from '../ui/components.js'
import { BillStatus, billWord, CourtStatus } from '../ui/status.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { dmy, dmyKey, has, money, todayKey } from '../core/format.js'
import { d } from '../core/text.js'
import { companyTitle, courtName, ROLE, TopBar } from './common.js'
import { orderRow } from './orders.js'

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

const ORDER = ['first', 'appellate', 'cassation', 'inspection']
const KEYS = { first: 'firstInstance', appellate: 'appellate', cassation: 'cassation', inspection: 'inspection' }

/** the first hearing from today on, over every instance (a past hearing that is still «scheduled» is not «next») */
function nextHearing(detail, row) {
  const today = todayKey()
  const all = ORDER.flatMap((k) => (detail[KEYS[k]]?.hearings || []).map((x) => ({ ...x, instance: INSTANCE[k] })))
  const upcoming = all.filter((x) => dmyKey(x.date) >= today).sort((a, b) => dmyKey(a.date) - dmyKey(b.date))[0]
  if (upcoming) return upcoming
  if (row && dmyKey(row.hearingDate) >= today) return { date: row.hearingDate, time: row.hearingTime }
  return null
}

export async function caseScreen(route, { signal }) {
  // the orders are a second, softer question: a case screen never fails because the orders could not be read
  const [{ case: c }, found] = await Promise.all([api.caseOf(route.key, { signal }), api.orders({ case: route.key }, { signal }).then((j) => j.orders).catch((e) => { if (e?.name === 'AbortError') throw e; return null })])
  const detail = c.detail || {}
  const g = detail.general
  const row = c.row
  const status = g?.caseStatus || row?.caseStatus
  const bills = c.bills || []
  const total = bills.reduce((a, b) => a + (Number(b.amount) || 0), 0)
  const copy = Button({ label: 'Nusxa', size: 'small', onClick: async () => { try { await navigator.clipboard.writeText(c.num); copy.textContent = 'Nusxalandi' } catch { /* not allowed here */ } } })
  const next = nextHearing(detail, row)
  const side = g || row
  const instances = ORDER.filter((k) => detail[KEYS[k]] && typeof detail[KEYS[k]] === 'object')
  const tab = instances.includes(route.tab) ? route.tab : instances.at(-1)

  return h('div', { class: 'screen stack' },
    TopBar(Button({ label: `STIR ${c.tin} ›`, size: 'small', onClick: () => go({ name: 'company', key: c.tin }) })),
    Hero({ caption: `${courtName(c.court)} ish`, id: c.num, line: `20${c.year} yilda roʻyxatga olingan`, aside: copy }, status && h('div', { class: 'screen__status' }, CourtStatus(status))),
    next && Callout('Navbatdagi majlis', [next.date, next.time].filter(has).join(' '), next.instance),
    c.role && h('p', { class: 'sideline' }, h('b', {}, `${companyTitle({ name: c.companyName, tin: c.tin })} — ${ROLE[c.role]}`), ` · qarshi tomon: ${d(c.counterparty)}`),
    side && Parties({ role: 'Daʼvogar', name: d(side.plaintiff) || '—', tin: g?.plaintiffTin, mine: c.role === 'plaintiff' }, { role: 'Javobgar', name: d(side.defendant) || '—', tin: g?.defendantTin, mine: c.role === 'defendant' }),
    g ? Card({ title: 'Umumiy' }, Kv('Turi', g.caseType), Kv('Daʼvo predmeti', g.claimSubject), Kv('Daʼvo summasi', g.claimAmount), Kv('Davlat boji', g.stateDuty), Kv('Sud', g.court), Kv('Hudud', g.region), Kv('Sudya', g.judge), Kv('Kotib', g.secretary), Kv('Joriy instansiya', INSTANCE[g.currentInstance] || g.currentInstance), Kv('Ariza sanasi', g.applicationDate), Kv('Ish qoʻzgatilgan', g.initiatedDate), Kv('Muddat', g.deadlineDate), Kv('Uchinchi shaxs', g.thirdParty), Kv('Vakil', g.representative), Kv('Prokuror', g.prosecutor))
      : row ? Card({ title: 'Umumiy (sud roʻyxatidan)' }, Kv('Turi', row.caseType), Kv('Daʼvo summasi', row.claimAmount), Kv('Sud', row.courtName), Kv('Sudya', row.judge), Kv('Ariza sanasi', row.dateFiled), Kv('Natija', row.result))
        : Card({}, h('p', { class: 'muted small' }, 'Batafsil maʼlumot zaxirada yoʻq: bu ish faqat kvitansiyalar orqali maʼlum. Ilovada kompaniya ishlari yangilanganda zaxiraga tushadi.')),
    instances.length > 0 && [
      instances.length > 1 && Tabs(instances.map((k) => ({ value: k, label: INSTANCE[k] })), tab, (v) => go({ name: 'case', key: c.num, tab: v }, { replace: true })),
      instance(INSTANCE[tab], detail[KEYS[tab]])],
    found && (found.rows.length > 0
      ? [SectionLabel(`Qarorlar (${found.rows.length})`), List(...found.rows.map((o) => orderRow(o, { withCase: false })))]
      : found.check ? h('p', { class: 'muted small hint' }, `Qaror eʼlon qilinmagan: ilova ${dmy(found.check)} da tekshirgan.`) : null),
    bills.length > 0 && [SectionLabel(`Kvitansiyalar (${bills.length}) · jami ${money(total)}`),
      List(...bills.map((b) => Row({ icon: 'bill', title: b.number, sub: `${d(b.cat)} · ${money(b.amount)} · ${billWord(b.status)}`, onOpen: () => go({ name: 'bill', key: b.number }) })))])
}
