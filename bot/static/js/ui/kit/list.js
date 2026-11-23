// LIST AND ROW. (Styles: css/components/list.css.)
import { h } from '../h.js'
import { icon } from '../icons.js'

/** a row: an icon, a title (mono), up to two sub lines (the second is clamped to two lines), a tag and a chevron */
export const Row = ({ icon: ic, title, sub, sub2, tag, onOpen }) =>
  h('div', { class: 'row', role: 'button', tabindex: '0', on: { click: onOpen, keydown: (e) => { if (e.key === 'Enter') onOpen() } } },
    ic && h('span', { class: 'row__icon' }, icon(ic)),
    tag && h('span', { class: 'tag' }, tag),
    h('div', { class: 'row__main' }, h('div', { class: 'row__title' }, title), sub != null && h('div', { class: 'row__sub' }, sub), sub2 && h('div', { class: 'row__sub row__sub--clamp' }, sub2)),
    h('span', { class: 'row__chev' }, icon('chevron', 18)))

export const List = (...rows) => h('div', { class: 'list' }, ...rows)
