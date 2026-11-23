// SURFACES: a card, a labelled value, a section label, the headline of a screen, a row of figures. (Styles: css/components/surface.css, chart.css.)
import { h } from '../h.js'
import { d } from '../../core/text.js'
import { has } from '../../core/format.js'

export const Card = ({ title } = {}, ...kids) => h('section', { class: 'card' }, title && h('h3', { class: 'card__title' }, title), ...kids)

/** a label and a value; nothing is drawn when the value is empty (the courts send «-» for «none») */
export const Kv = (label, value, { raw = false } = {}) => (has(value) ? h('div', { class: 'kv' }, h('span', { class: 'kv__k' }, label), h('span', { class: 'kv__v' }, raw ? value : d(value))) : null)

export const SectionLabel = (text) => h('div', { class: 'section-label' }, text)

/** the headline of a screen: a small caption, the identifier (`name`: a name in sans, else a number in mono), a line under it */
export const Hero = ({ caption, id, line, aside, name = false }, ...kids) =>
  h('section', { class: 'hero' }, h('div', { class: 'split' }, h('span', { class: 'hero__caption' }, caption), aside), h('p', { class: name ? 'hero__id hero__id--name' : 'hero__id mono' }, id), line && h('p', { class: 'hero__line' }, line), ...kids)

export const Stats = (...items) => h('div', { class: 'stats' }, ...items.map(([value, label]) => h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label))))
