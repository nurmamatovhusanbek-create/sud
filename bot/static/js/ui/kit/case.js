// CASE: what only a court case screen needs. (Styles: css/components/case.css.)
import { h } from '../h.js'

/** the two sides of a case, side by side; `mine: true` outlines the company's own side and adds «· siz» */
export const Parties = (left, right) => {
  const side = (p) => h('div', { class: p.mine ? 'party party--mine' : 'party' }, h('span', { class: 'party__role' }, p.mine ? `${p.role} · siz` : p.role), h('span', { class: 'party__name' }, p.name), p.tin && h('span', { class: 'party__tin mono' }, p.tin))
  return h('div', { class: 'parties' }, side(left), h('span', { class: 'parties__vs', 'aria-hidden': 'true' }, 'vs'), side(right))
}

/** one line that must not be missed (the next hearing) */
export const Callout = (label, main, sub) =>
  h('div', { class: 'callout' }, h('span', { class: 'callout__label' }, label), h('span', { class: 'callout__main mono' }, main), sub && h('span', { class: 'callout__sub' }, sub))

export const Timeline = (items) => h('ol', { class: 'timeline' }, ...items.map((it, i) => h('li', { class: `timeline__item${i === items.length - 1 ? ' timeline__item--current' : ''}` }, it)))
