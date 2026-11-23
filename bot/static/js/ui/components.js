// The component set. Each function returns a DOM node built from tokens' classes (components.css). Screens compose these; they add no look of their own.
import { h } from './h.js'
import { icon } from './icons.js'
import { d } from '../core/text.js'
import { has } from '../core/format.js'

export const Card = ({ title } = {}, ...kids) => h('section', { class: 'card' }, title && h('h3', { class: 'card__title' }, title), ...kids)

/** a label and a value; nothing is drawn when the value is empty (the courts send «-» for «none») */
export const Kv = (label, value, { raw = false } = {}) => (has(value) ? h('div', { class: 'kv' }, h('span', { class: 'kv__k' }, label), h('span', { class: 'kv__v' }, raw ? value : d(value))) : null)

export const SectionLabel = (text) => h('div', { class: 'section-label' }, text)

export const Row = ({ icon: ic, title, sub, sub2, tag, onOpen }) =>
  h('div', { class: 'row', role: 'button', tabindex: '0', on: { click: onOpen, keydown: (e) => { if (e.key === 'Enter') onOpen() } } },
    ic && h('span', { class: 'row__icon' }, icon(ic)),
    tag && h('span', { class: 'tag' }, tag),
    h('div', { class: 'row__main' }, h('div', { class: 'row__title' }, title), sub != null && h('div', { class: 'row__sub' }, sub), sub2 && h('div', { class: 'row__sub row__sub--clamp' }, sub2)),
    h('span', { class: 'row__chev' }, icon('chevron', 18)))

export const List = (...rows) => h('div', { class: 'list' }, ...rows)

/** kind: done | live | hold | void: a filled dot, a ring, a half dot, a dashed ring. The words carry the meaning, the shape only helps the eye. */
export const Status = (kind, label) => h('span', { class: 'status' }, h('span', { class: `dot dot--${kind}` }), label)

export const Button = ({ label, onClick, variant, size, block }) =>
  h('button', { type: 'button', class: ['btn', variant && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block'].filter(Boolean).join(' '), on: { click: onClick } }, label)

export function Chips(options, value, onPick, { scroll = false } = {}) {
  return h('div', { class: scroll ? 'chips chips--scroll' : 'chips' }, ...options.map((o) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.value === value), on: { click: () => onPick(o.value) } }, o.label)))
}

export function Tabs(options, value, onPick) {
  return h('div', { class: 'tabs', role: 'tablist' }, ...options.map((o) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(o.value === value), on: { click: () => onPick(o.value) } }, o.label)))
}

export const Stats = (...items) => h('div', { class: 'stats' }, ...items.map(([value, label]) => h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label))))

export const Timeline = (items) => h('ol', { class: 'timeline' }, ...items.map((it, i) => h('li', { class: `timeline__item${i === items.length - 1 ? ' timeline__item--current' : ''}` }, it)))

export function Field({ placeholder, value = '', onInput, compact, mono = true }) {
  const input = h('input', { type: 'text', value, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, inputMode: 'search', enterKeyHint: 'search' })
  const wrap = h('label', { class: `field${compact ? ' field--compact' : ''}${value ? ' field--filled' : ''}` }, icon('search', 18), input,
    h('button', { type: 'button', class: 'field__clear', 'aria-label': 'Tozalash', on: { click: () => { input.value = ''; wrap.classList.remove('field--filled'); onInput(''); input.focus() } } }, icon('close', 16)))
  input.addEventListener('input', () => { wrap.classList.toggle('field--filled', input.value !== ''); onInput(input.value) })
  return { el: wrap, input }
}

export const Skeletons = (n = 3) => h('div', { class: 'stack' }, ...Array.from({ length: n }, () => h('div', { class: 'skeleton' })))
export const Empty = (text) => h('div', { class: 'empty' }, text)
export function ErrorBox(message, onRetry) {
  return h('div', { class: 'empty empty--error' }, message, onRetry && h('div', { class: 'screen__more' }, Button({ label: 'Qayta urinish', onClick: onRetry, size: 'small' })))
}

// ---- charts: plain DOM, no libraries. A value reaches the CSS as a custom property set through the CSSOM (the CSP forbids style attributes). ----
const share = (el, v) => { el.style.setProperty('--v', String(Math.max(0, Math.min(1, v)))); return el }

/** horizontal bars: [{ label, value, onPick? }] against the largest value */
export function Bars(items, { format = String } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return h('div', { class: 'bars' }, ...items.map((i) => {
    const tag = i.onPick ? 'button' : 'div'
    return h(tag, { class: 'bars__row', type: i.onPick ? 'button' : undefined, on: i.onPick ? { click: i.onPick } : undefined },
      h('span', { class: 'bars__label' }, i.label),
      h('span', { class: 'bars__track' }, share(h('span', { class: 'bars__fill' }), i.value / max)),
      h('span', { class: 'bars__value mono' }, format(i.value)))
  }))
}

/** vertical columns, one per label (a year), two series: the tall one is `a`, the line over it `b` */
export function Columns(items) {
  const max = Math.max(1, ...items.map((i) => i.a))
  return h('div', { class: 'cols', role: 'img', 'aria-label': 'Yillar boʻyicha' }, ...items.map((i) =>
    h('div', { class: 'cols__col' },
      h('span', { class: 'cols__value mono' }, i.a),
      h('span', { class: 'cols__bar' }, share(h('span', { class: 'cols__fill' }), i.a / max)),
      h('span', { class: 'cols__label mono' }, String(i.label).slice(-2)))))
}

/** the two sides of a case, side by side */
export const Parties = (left, right) =>
  h('div', { class: 'parties' },
    h('div', { class: left.mine ? 'party party--mine' : 'party' }, h('span', { class: 'party__role' }, left.mine ? `${left.role} · siz` : left.role), h('span', { class: 'party__name' }, left.name), left.tin && h('span', { class: 'party__tin mono' }, left.tin)),
    h('span', { class: 'parties__vs', 'aria-hidden': 'true' }, 'vs'),
    h('div', { class: right.mine ? 'party party--mine' : 'party' }, h('span', { class: 'party__role' }, right.mine ? `${right.role} · siz` : right.role), h('span', { class: 'party__name' }, right.name), right.tin && h('span', { class: 'party__tin mono' }, right.tin)))

/** one line that must not be missed (the next hearing) */
export const Callout = (label, main, sub) =>
  h('div', { class: 'callout' }, h('span', { class: 'callout__label' }, label), h('span', { class: 'callout__main mono' }, main), sub && h('span', { class: 'callout__sub' }, sub))

/** the headline of a screen: a small caption, the identifier, a line under it */
export const Hero = ({ caption, id, line, aside, name = false }, ...kids) =>
  h('section', { class: 'hero' }, h('div', { class: 'split' }, h('span', { class: 'hero__caption' }, caption), aside), h('p', { class: name ? 'hero__id hero__id--name' : 'hero__id mono' }, id), line && h('p', { class: 'hero__line' }, line), ...kids)

/**
 * A row of cards to choose one from (swipe sideways): [{ value, title, big, sub }]. The chosen card is filled. Used for «all companies / one company» so a
 * list of a hundred rows can be narrowed with one tap instead of scrolled.
 */
export function CardRow(items, value, onPick) {
  return h('div', { class: 'cardrow', role: 'group' }, ...items.map((i) =>
    h('button', { type: 'button', class: 'mcard', 'aria-pressed': String(i.value === value), on: { click: () => onPick(i.value) } },
      h('span', { class: 'mcard__title mono' }, i.title),
      h('span', { class: 'mcard__big mono' }, i.big),
      i.sub && h('span', { class: 'mcard__sub' }, i.sub))))
}

/** the bottom bar: [{ value, label, icon }] */
export function TabBar(items, value, onPick) {
  return items.map((i) =>
    h('button', { type: 'button', class: 'tabbar__item', 'aria-current': i.value === value ? 'page' : undefined, on: { click: () => onPick(i.value) } },
      icon(i.icon, 22), h('span', {}, i.label)))
}
