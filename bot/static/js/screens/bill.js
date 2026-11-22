import { h } from '../ui/h.js'
import { Card, Kv, List, Row } from '../ui/components.js'
import { BillStatus } from '../ui/status.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { dmy, has, money } from '../core/format.js'
import { d } from '../core/prefs.js'
import { TopBar } from './common.js'

export async function bill(route, { signal }) {
  const { bill: b } = await api.bill(route.key, { signal })
  return h('div', { class: 'screen stack' },
    TopBar(),
    Card({}, h('p', { class: 'card__id mono' }, b.number), h('div', { class: 'screen__lead' }, d(b.cat)), h('div', { class: 'screen__status' }, BillStatus(b.status))),
    Card({ title: 'Summa' }, Kv('Summa', money(b.amount), { raw: true }), Kv('Toʻlangan', money(b.paid), { raw: true }), Kv('Qoldiq', money(b.balance), { raw: true }), Kv('Toʻlanishi kerak', money(b.mustPay), { raw: true }), Kv('Berilgan', dmy(b.issued), { raw: true }), Kv('Muddat', dmy(b.overdue), { raw: true })),
    Card({ title: 'Tafsilot' }, Kv('Sud', b.court), Kv('Toʻlovchi', b.payer), Kv('Toʻlovchi STIR', b.payerTin), Kv('STIR', b.tin)),
    has(b.caseNumber) && List(Row({ icon: 'case', title: b.caseNumber, sub: 'Ish', onOpen: () => go({ name: 'case', key: b.caseNumber }) })))
}
