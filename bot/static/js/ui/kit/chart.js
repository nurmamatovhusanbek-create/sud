// CHARTS: plain DOM, no libraries. A value reaches the CSS as a custom property set through the CSSOM (the CSP forbids style attributes). (Styles: css/components/chart.css.)
import { h } from '../h.js'

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

/** vertical columns, one per label (a year): [{ label, a }] */
export function Columns(items) {
  const max = Math.max(1, ...items.map((i) => i.a))
  return h('div', { class: 'cols', role: 'img', 'aria-label': 'Yillar boʻyicha' }, ...items.map((i) =>
    h('div', { class: 'cols__col' },
      h('span', { class: 'cols__value mono' }, i.a),
      h('span', { class: 'cols__bar' }, share(h('span', { class: 'cols__fill' }), i.a / max)),
      h('span', { class: 'cols__label mono' }, String(i.label).slice(-2)))))
}
