// Text that comes from the courts (names, courts, statuses) is in Cyrillic; the app is Latin only (same rules as the app's core/translit.ts).
import { toLatin } from './translit.js'

export const d = (s) => (s == null ? '' : toLatin(String(s)))
