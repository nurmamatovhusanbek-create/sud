import { h } from '../ui/h.js'
import { Empty, List, Row, SectionLabel } from '../ui/components.js'
import { api } from '../core/api.js'
import { go } from '../core/router.js'
import { num } from '../core/format.js'
import { courtName } from './common.js'
import { setHint } from '../shell.js'

const GROUPS = [['company', 'Kompaniyalar', 'company'], ['case', 'Ishlar', 'case'], ['bill', 'Kvitansiyalar', 'bill']]

function subOf(x) {
  if (x.kind === 'company') return `${num(x.bills)} toʻlov · ${num(x.found)} ish`
  if (x.kind === 'bill') return `${x.caseNumber ? `ish ${x.caseNumber} · ` : ''}${x.year}`
  return `${courtName(x.court)} · 20${x.year}`
}

export async function search(route, { signal }) {
  const j = await api.search(route.q, { signal })
  setHint(j.info)
  if (!j.hits.length) return h('div', { class: 'screen' }, Empty(j.info?.ready ? 'Topilmadi.' : 'Zaxira hali yuklanmoqda, birozdan soʻng qayta urining.'))
  const out = h('div', { class: 'screen' })
  for (const [kind, label, ic] of GROUPS) {
    const xs = j.hits.filter((x) => x.kind === kind)
    if (!xs.length) continue
    out.append(SectionLabel(`${label} (${xs.length}${xs.length >= 30 ? '+' : ''})`),
      List(...xs.map((x) => Row({ icon: ic, title: x.key, sub: subOf(x), onOpen: () => go(kind === 'company' ? { name: 'company', key: x.tin } : { name: kind, key: x.key }) }))))
  }
  return out
}
