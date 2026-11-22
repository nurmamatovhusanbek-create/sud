import { h } from '../ui/h.js'
import { Card, Empty, List, Row } from '../ui/components.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { dmy, num } from '../core/format.js'
import { setHint } from '../shell.js'

export async function home(_route, { signal }) {
  const j = await api.companies({ signal })
  setHint(j.info)
  const nodes = []
  if (!j.info?.ready) nodes.push(Empty('Zaxira hali yuklanmoqda, bir ozdan soʻng qayta oching.'))
  nodes.push(Card({ title: 'Qidirish' }, h('p', { class: 'muted small' }, 'Ish raqami (', h('span', { class: 'mono' }, '2-1004-2603'), '), kvitansiya raqami (6+ raqam) yoki STIR (3+ raqam) yozing. Natijani bossangiz batafsil maʼlumot ochiladi.')))
  nodes.push(List(...(j.companies || []).map((c) =>
    Row({ icon: 'company', title: c.tin, sub: `${num(c.bills)} toʻlov · ${num(c.found)} topilgan ish${c.refreshedAt ? ` · ${dmy(c.refreshedAt)} holatiga` : ''}`, onOpen: () => go({ name: 'company', key: c.tin }) }))))
  return h('div', { class: 'screen stack' }, ...nodes)
}
