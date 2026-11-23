// STATUS AND FEEDBACK. (Styles: css/components/status.css, feedback.css.)
import { h } from '../h.js'
import { Button } from './control.js'

/** kind: done | live | hold | bad | void → green filled dot, blue ring, blue half dot, rose filled dot, grey dashed ring. The words carry the meaning. */
export const Status = (kind, label) => h('span', { class: `status status--${kind}` }, h('span', { class: `dot dot--${kind}` }), label)

export const Skeletons = (n = 3) => h('div', { class: 'stack' }, ...Array.from({ length: n }, () => h('div', { class: 'skeleton' })))
export const Empty = (text) => h('div', { class: 'empty' }, text)
export function ErrorBox(message, onRetry) {
  return h('div', { class: 'empty empty--error' }, message, onRetry && h('div', { class: 'screen__more' }, Button({ label: 'Qayta urinish', onClick: onRetry, size: 'small' })))
}
