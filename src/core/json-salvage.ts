/**
 * Salvage a JSON ARRAY that was cut short. The court API (jadvalapi findByTin) has no pagination: a company with thousands of cases (a bank)
 * answers with one multi-megabyte array, and a connection that drops or stalls at 80% used to cost ALL of it (JSON.parse throws). The
 * elements before the cut are complete objects, so they are kept: `complete` says whether the array was closed.
 * Pure: a small state machine over the text (string / escape / depth), no I/O.
 */
export function salvageJsonArray(text: string): { items: unknown[]; complete: boolean } {
  try {
    const whole = JSON.parse(text)
    if (Array.isArray(whole)) return { items: whole, complete: true }
  } catch {
    /* cut short, or not an array: scan */
  }
  const i0 = text.indexOf('[')
  if (i0 < 0) return { items: [], complete: false }
  const items: unknown[] = []
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1
  for (let i = i0 + 1; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      if (depth === 0 && start < 0) start = i // a bare string element
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) {
        if (ch === ']') return { items, complete: true } // the array's own close (parse failed for another reason: keep what we have)
        continue
      }
      depth--
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(text.slice(start, i + 1)))
        } catch {
          /* a damaged element: skip it */
        }
        start = -1
      }
    }
  }
  return { items, complete: false }
}
