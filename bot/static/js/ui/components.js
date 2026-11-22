// The component set. Each function returns a DOM node built from tokens' classes (components.css). Screens compose these; they add no look of their own.
import { h } from './h.js'
import { icon } from './icons.js'
import { d } from '../core/prefs.js'
import { has } from '../core/format.js'

export const Card = ({ title } = {}, ...kids) => h('section', { class: 'card' }, title && h('h3', { class: 'card__title' }, title), ...kids)

/** a label and a value; nothing is drawn when the value is empty (the courts send «-» for «none») */
export const Kv = (label, value, { raw = false } = {}) => (has(value) ? h('div', { class: 'kv' }, h('span', { class: 'kv__k' }, label), h('span', { class: 'kv__v' }, raw ? value : d(value))) : null)

export const SectionLabel = (text) => h('div', { class: 'section-label' }, text)

export const Row = ({ icon: ic, title, sub, tag, onOpen }) =>
  h('div', { class: 'row', role: 'button', tabindex: '0', on: { click: onOpen, keydown: (e) => { if (e.key === 'Enter') onOpen() } } },
    ic && h('span', { class: 'row__icon' }, icon(ic)),
    tag && h('span', { class: 'tag' }, tag),
    h('div', { class: 'row__main' }, h('div', { class: 'row__title' }, title), sub != null && h('div', { class: 'row__sub' }, sub)),
    h('span', { class: 'row__chev' }, icon('chevron', 18)))

export const List = (...rows) => h('div', { class: 'list' }, ...rows)

/** kind: done | live | hold | void: a filled dot, a ring, a half dot, a dashed ring. The words carry the meaning, the shape only helps the eye. */
export const Status = (kind, label) => h('span', { class: 'status' }, h('span', { class: `dot dot--${kind}` }), label)

export const Button = ({ label, onClick, variant, size, block }) =>
  h('button', { type: 'button', class: ['btn', variant && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block'].filter(Boolean).join(' '), on: { click: onClick } }, label)

export function Chips(options, value, onPick) {
  return h('div', { class: 'chips' }, ...options.map((o) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.value === value), on: { click: () => onPick(o.value) } }, o.label)))
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

export const Segmented = (options, value, onPick) =>
  h('div', { class: 'segmented', role: 'group' }, ...options.map((o) => h('button', { type: 'button', 'aria-pressed': String(o.value === value), on: { click: () => onPick(o.value) } }, o.label)))

export const Skeletons = (n = 3) => h('div', { class: 'stack' }, ...Array.from({ length: n }, () => h('div', { class: 'skeleton' })))
export const Empty = (text) => h('div', { class: 'empty' }, text)
export function ErrorBox(message, onRetry) {
  return h('div', { class: 'empty empty--error' }, message, onRetry && h('div', { class: 'screen__more' }, Button({ label: 'Qayta urinish', onClick: onRetry, size: 'small' })))
}
