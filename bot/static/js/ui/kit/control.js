// CONTROLS. (Styles: css/components/control.css, choice.css.)
import { h } from '../h.js'
import { icon } from '../icons.js'

export const Button = ({ label, onClick, variant, size, block }) =>
  h('button', { type: 'button', class: ['btn', variant && `btn--${variant}`, size && `btn--${size}`, block && 'btn--block'].filter(Boolean).join(' '), on: { click: onClick } }, label)

/** a square button with one icon (an `aria-label` names it for a screen reader) */
export const IconButton = ({ name, label, onClick }) =>
  h('button', { type: 'button', class: 'iconbtn', 'aria-label': label, on: { click: onClick } }, icon(name, 20))

export function Chips(options, value, onPick, { scroll = false } = {}) {
  return h('div', { class: scroll ? 'chips chips--scroll' : 'chips' }, ...options.map((o) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.value === value), on: { click: () => onPick(o.value) } }, o.label)))
}

export function Tabs(options, value, onPick) {
  return h('div', { class: 'tabs', role: 'tablist' }, ...options.map((o) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(o.value === value), on: { click: () => onPick(o.value) } }, o.label)))
}

/** a search/filter field with a clear button; returns { el, input } so the caller keeps focus while the list under it is redrawn */
export function Field({ placeholder, value = '', onInput, compact }) {
  const input = h('input', { type: 'text', value, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, inputMode: 'search', enterKeyHint: 'search' })
  const wrap = h('label', { class: `field${compact ? ' field--compact' : ''}${value ? ' field--filled' : ''}` }, icon('search', 18), input,
    h('button', { type: 'button', class: 'field__clear', 'aria-label': 'Tozalash', on: { click: () => { input.value = ''; wrap.classList.remove('field--filled'); onInput(''); input.focus() } } }, icon('close', 16)))
  input.addEventListener('input', () => { wrap.classList.toggle('field--filled', input.value !== ''); onInput(input.value) })
  return { el: wrap, input }
}

/** cards to choose one from (swipe sideways): [{ value, title, big, sub }]; the chosen card is filled */
export function CardRow(items, value, onPick) {
  return h('div', { class: 'cardrow', role: 'group' }, ...items.map((i) =>
    h('button', { type: 'button', class: 'mcard', 'aria-pressed': String(i.value === value), on: { click: () => onPick(i.value) } },
      h('span', { class: 'mcard__title mono' }, i.title),
      h('span', { class: 'mcard__big mono' }, i.big),
      i.sub && h('span', { class: 'mcard__sub' }, i.sub))))
}

/**
 * a labelled drop-down: `options` = [{ value, label }], `value` the chosen one ('' = «all»); it is marked when something other than «all» is chosen.
 * Returns the element; `el.select` is the <select> (so a screen can set it back).
 */
export function Select({ label, options, value, onPick }) {
  const sel = h('select', { 'aria-label': label, on: { change: () => { box.classList.toggle('select--active', sel.value !== ''); onPick(sel.value) } } },
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)))
  const box = h('label', { class: `select${value !== '' && value != null ? ' select--active' : ''}` }, h('span', { class: 'select__label' }, label), h('span', { class: 'select__box' }, sel, icon('chevron', 16)))
  box.select = sel
  return box
}
