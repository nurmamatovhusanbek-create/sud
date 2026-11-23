// The home screen is three tabs (the bottom bar): «Majlislar», «Toʻlovlar», «Kompaniyalar». Each is a screen of its own; this one only picks.
import { h } from '../ui/h.js'
import { api } from '../core/api.js'
import { setHint } from '../shell.js'
import { hearingsTab } from './hearings.js'
import { billsTab } from './bills-tab.js'
import { companiesTab } from './companies.js'
import { TABS } from './common.js'

export async function home(route, ctx) {
  // the header's one-line hint (how much the backup holds, as of when) comes from the cheap companies call
  api.companies(ctx).then((j) => setHint(j.info)).catch(() => {})
  const tab = TABS.some((t) => t.value === route.tab) ? route.tab : 'hearings'
  const body = tab === 'hearings' ? hearingsTab(route, ctx) : tab === 'bills' ? await billsTab(route, ctx) : await companiesTab(route, ctx)
  return h('div', { class: 'screen' }, body)
}
