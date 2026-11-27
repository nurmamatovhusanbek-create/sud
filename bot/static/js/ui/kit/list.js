// LIST AND ROW. (Styles: css/components/list.css.)
import { h } from '../h.js'
import { icon } from '../icons.js'
import { SIZES } from '../../core/page-size.js'

/** a row: an icon, a title (mono), up to two sub lines (the second is clamped to two lines), a tag and a chevron */
export const Row = ({ icon: ic, title, sub, sub2, tag, onOpen }) =>
  h('div', { class: 'row', role: 'button', tabindex: '0', on: { click: onOpen, keydown: (e) => { if (e.key === 'Enter') onOpen() } } },
    ic && h('span', { class: 'row__icon' }, icon(ic)),
    tag && h('span', { class: 'tag' }, tag),
    h('div', { class: 'row__main' }, h('div', { class: 'row__title' }, title), sub != null && h('div', { class: 'row__sub' }, sub), sub2 && h('div', { class: 'row__sub row__sub--clamp' }, sub2)),
    h('span', { class: 'row__chev' }, icon('chevron', 18)))

export const List = (...rows) => h('div', { class: 'list' }, ...rows)

/**
 * PAGINATION: «Sahifada [30 ▾]  ‹‹ ‹  3 / 12  › ››» and the range «61–90 / 357». `page` is 1-based; `onPage(n)` and `onSize(n)` redraw the list.
 * Nothing is shown for a list that fits one page at the smallest size. Used above AND below a long list (the person never scrolls just to turn the page).
 */
export function Pager({ page, size, total, onPage, onSize }) {
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(total, page * size)
  const go = (n, label, text, off) => h('button', { type: 'button', class: 'pager__btn', 'aria-label': label, disabled: off, on: { click: () => onPage(n) } }, text)
  const sel = h('select', { class: 'pager__size', 'aria-label': 'Sahifadagi qatorlar soni', on: { change: () => onSize(Number(sel.value)) } },
    ...SIZES.map((n) => h('option', { value: String(n), selected: n === size }, String(n))))
  if (total <= SIZES[0]) return h('div', { class: 'pager pager--min' }, h('span', { class: 'pager__range muted small' }, `${from}–${to} / ${total}`))
  return h('div', { class: 'pager' },
    h('label', { class: 'pager__sizebox' }, h('span', { class: 'muted small' }, 'Sahifada'), sel),
    h('span', { class: 'pager__range muted small' }, `${from}–${to} / ${total}`),
    h('span', { class: 'pager__nav' },
      go(1, 'Birinchi sahifa', icon('first', 18), page <= 1),
      go(page - 1, 'Oldingi sahifa', icon('back', 18), page <= 1),
      h('span', { class: 'pager__page mono' }, `${page} / ${pages}`),
      go(page + 1, 'Keyingi sahifa', icon('chevron', 18), page >= pages),
      go(pages, 'Oxirgi sahifa', icon('last', 18), page >= pages)))
}
