/**
 * The maths of a counting number (`CountUp`), kept pure so it can be tested.
 *
 * The bug it fixes: invoices stream in one by one, so the target goes 1 → 2 → 3 → 4 → 5 while a tween is still running. The old
 * counter only remembered where a tween STARTED and wrote «arrived» when it finished, so every retarget (the previous tween was
 * cancelled half way) restarted from the old start: «1-2-1-2-3-1-2-3-4…». A retarget must start from the value that is on
 * screen right now, which is why `countAt` is a function of (from, to, progress) and the component stores the CURRENT float
 * every frame, not the start.
 */

/** the longest a count takes (a big jump, or the first paint) */
export const COUNT_MAX_MS = 750
/** the shortest: a +1 must still read as a step, but never lag behind the next arrival */
export const COUNT_MIN_MS = 220

/** time for a move of `delta`: a few units are quick, big jumps use the full duration */
export function countDuration(delta: number): number {
  const d = Math.abs(delta)
  return Math.round(Math.min(COUNT_MAX_MS, Math.max(COUNT_MIN_MS, 160 + d * 90)))
}

/** ease-out cubic, `p` in 0..1 */
export function easeOutCubic(p: number): number {
  const q = 1 - Math.min(1, Math.max(0, p))
  return 1 - q * q * q
}

/** the (unrounded) value of a tween from `from` to `to` at progress `p` (0..1) */
export function countAt(from: number, to: number, p: number): number {
  return from + (to - from) * easeOutCubic(p)
}
