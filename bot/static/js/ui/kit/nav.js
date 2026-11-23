// NAVIGATION. (Styles: css/components/nav.css.)
import { h } from '../h.js'
import { icon } from '../icons.js'

/** the bottom bar: [{ value, label, icon }] → nodes; the current one is marked */
export function TabBar(items, value, onPick) {
  return items.map((i) =>
    h('button', { type: 'button', class: 'tabbar__item', 'aria-current': i.value === value ? 'page' : undefined, on: { click: () => onPick(i.value) } },
      icon(i.icon, 22), h('span', {}, i.label)))
}
