// The person's two choices, kept in this browser only: the alphabet and nothing else. Storage can be unavailable (private mode): never throw.
import { toLatin } from './translit.js'

const KEY = 'alpha'
let alphabet = 'lat'
try { alphabet = localStorage.getItem(KEY) === 'cyr' ? 'cyr' : 'lat' } catch { /* default */ }
const listeners = new Set()

export const getAlphabet = () => alphabet
export function setAlphabet(a) {
  alphabet = a === 'cyr' ? 'cyr' : 'lat'
  try { localStorage.setItem(KEY, alphabet) } catch { /* not kept */ }
  listeners.forEach((fn) => fn(alphabet))
}
export const onAlphabet = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/** text that comes from the courts (names, courts, statuses), in the chosen alphabet */
export const d = (s) => (s == null ? '' : alphabet === 'lat' ? toLatin(String(s)) : String(s))
