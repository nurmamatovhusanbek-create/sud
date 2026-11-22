// What a court status or a bill status MEANS, as one of four shapes (see components.js Status). Words stay the court's own (in the chosen alphabet).
import { Status } from './components.js'
import { d } from '../core/prefs.js'

const COURT = [
  [/якунланган|tugatil|yakunlan/i, 'done'],
  [/иш юритувда|кўриб|jarayon|ish yurit|ko.rib/i, 'live'],
  [/тўхтатил|to.xtatil|кечиктир/i, 'hold'],
  [/бекор|рад|bekor|rad/i, 'void'],
]
export function CourtStatus(text) {
  const kind = COURT.find(([re]) => re.test(text || ''))?.[1] || 'live'
  return Status(kind, d(text))
}

const BILL = { PAID: ['Toʻlangan', 'done'], USED: ['Ishlatilgan', 'done'], CREATED: ['Yaratilgan', 'live'], OVERDUE: ['Muddati oʻtgan', 'hold'], CANCELED: ['Bekor qilingan', 'void'], CANCELLED: ['Bekor qilingan', 'void'], EXPIRED: ['Muddati tugagan', 'void'] }
export const billWord = (s) => BILL[s]?.[0] || s || ''
export const BillStatus = (s) => Status(BILL[s]?.[1] || 'live', billWord(s))
