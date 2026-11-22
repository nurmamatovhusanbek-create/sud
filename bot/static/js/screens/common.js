// Pieces several screens share.
import { h } from '../ui/h.js'
import { Button } from '../ui/components.js'
import { back } from '../core/router.js'

export const COURT = { civil: 'Fuqarolik', economic: 'Iqtisodiy', administrative: 'Maʼmuriy', criminal: 'Jinoyat' }
export const courtName = (c) => COURT[c] || c || '—'

export function TopBar(...extra) {
  return h('div', { class: 'screen__top' }, Button({ label: '← Orqaga', onClick: back }), h('span', { class: 'grow' }), ...extra)
}
