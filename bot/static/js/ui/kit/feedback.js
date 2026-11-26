// STATUS AND FEEDBACK. (Styles: css/components/status.css, feedback.css.)
import { h } from '../h.js'
import { Button } from './control.js'

/** kind: done | live | hold | bad | void → green filled dot, blue ring, blue half dot, rose filled dot, grey dashed ring. The words carry the meaning. */
export const Status = (kind, label) => h('span', { class: `status status--${kind}` }, h('span', { class: `dot dot--${kind}` }), label)

/** n rows of grey lines where the list will be (the row shape: a title and two sub lines); announced once as «loading» */
export const Skeletons = (n = 3) =>
  h('div', { class: 'stack', role: 'status', 'aria-label': 'Yuklanmoqda', 'aria-busy': 'true' }, ...Array.from({ length: n }, () => h('div', { class: 'skeleton' }, h('span', { class: 'skeleton__line skeleton__line--title' }), h('span', { class: 'skeleton__line skeleton__line--sub' }), h('span', { class: 'skeleton__line skeleton__line--short' }))))
export const Empty = (text) => h('div', { class: 'empty' }, text)
export function ErrorBox(message, onRetry) {
  return h('div', { class: 'empty empty--error' }, message, onRetry && h('div', { class: 'screen__more' }, Button({ label: 'Qayta urinish', onClick: onRetry, size: 'small' })))
}
