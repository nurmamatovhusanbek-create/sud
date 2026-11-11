/**
 * Hearing preparation: what is settled, what is still open. Some items the app can tell by itself (the case was read,
 * a representative is named, a document was prepared from it); the rest only the lawyer can tick. Pure: the screen
 * hands in the facts and the ticks, and draws what comes back.
 */

export type PrepItemId = 'case' | 'representative' | 'counterparty' | 'orders' | 'documents'

export interface PrepFacts {
  /** the case detail was read */
  caseRead: boolean
  /** the case names a representative */
  representative: boolean
  /** a document was prepared from this case (the button was used) */
  documentPrepared: boolean
}

export interface PrepItem {
  id: PrepItemId
  label: string
  hint: string
  done: boolean
  /** true = decided by the app, not tickable */
  auto: boolean
}

export function prepChecklist(f: PrepFacts, ticked: ReadonlySet<string>): PrepItem[] {
  return [
    { id: 'case', label: 'Ish maʼlumotlari oʻqildi', hint: 'Sud, sudya, tomonlar, daʼvo predmeti', done: f.caseRead, auto: true },
    { id: 'representative', label: 'Vakil belgilangan', hint: 'Ishda vakil koʻrsatilgan boʻlishi kerak', done: f.representative || ticked.has('representative'), auto: f.representative },
    { id: 'counterparty', label: 'Qarshi tomon tarixi koʻrib chiqildi', hint: 'Avvalgi ishlar va ularning natijasi', done: ticked.has('counterparty'), auto: false },
    { id: 'orders', label: 'Eʼlon qilingan qarorlar tekshirildi', hint: 'Shu tomon bilan oldingi qarorlar', done: ticked.has('orders'), auto: false },
    { id: 'documents', label: 'Kerakli hujjatlar tayyorlandi', hint: 'Ariza, iltimosnoma yoki nusxa soʻrovi', done: f.documentPrepared || ticked.has('documents'), auto: f.documentPrepared },
  ]
}

export function prepProgress(items: readonly PrepItem[]): { done: number; total: number; ready: boolean } {
  const done = items.filter((i) => i.done).length
  return { done, total: items.length, ready: done === items.length }
}
