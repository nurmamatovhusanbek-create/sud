import { toast as base, type ExternalToast } from 'sonner'

/**
 * THE toast of the app: sonner, with three rules so that a pop-up stays a short pop-up (owner: «sometimes they overlap, over top and have very large text
 * instead of a short explanation»).
 *  1. A title is a short line. A long message (an upstream error, a path, a whole sentence) is cut at its first sentence or clause; the rest goes into the
 *     description, itself clipped. The CSS clamps both to a few lines as a last resort.
 *  2. The same message while it is still on screen REPLACES itself (an id from type + title) instead of piling up; a call that gives its own `id` keeps it
 *     (loading → success updates).
 *  3. ONE place: the bottom right corner (`<Toaster>` in the layout). A call may not choose another (a «top-left» loading toast sat over the header).
 * Call it exactly as sonner's `toast` (it is the same function with the same methods); import it from here, never from `sonner`.
 */

export const TITLE_MAX = 90
export const DESC_MAX = 200

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** cut at a word, with an ellipsis */
export function clip(s: string, max: number): string {
  const t = squash(s)
  if (t.length <= max) return t
  const head = t.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  return `${(space > max * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:.\-–—]+$/, '')}…`
}

/** a message as a short title and the rest (null when there is nothing more to say) */
export function split(message: string): { title: string; rest: string | null } {
  const t = squash(message)
  if (t.length <= TITLE_MAX) return { title: t, rest: null }
  // the first sentence or clause that fits
  const m = /^(.{12,100}?[.!?:;])\s+(.+)$/.exec(t) ?? /^(.{12,100}?)\s+[—–-]\s+(.+)$/.exec(t)
  if (m && m[1]!.length <= TITLE_MAX + 10) return { title: m[1]!.replace(/[:;]$/, ''), rest: m[2]! }
  const title = clip(t, TITLE_MAX)
  return { title, rest: t.slice(title.replace(/…$/, '').length).trim() || null }
}

type Title = Parameters<typeof base>[0]

export function tidy(type: string, message: Title, opts?: ExternalToast): [Title, ExternalToast] {
  const o: ExternalToast = { ...(opts ?? {}) }
  delete (o as { position?: unknown }).position // one corner for every pop-up
  if (typeof message !== 'string') return [message, o]
  const { title, rest } = split(message)
  if (rest) {
    const had = typeof o.description === 'string' ? squash(o.description) : null
    if (had === null && o.description === undefined) o.description = clip(rest, DESC_MAX)
    else if (had !== null) o.description = clip(`${rest} ${had}`, DESC_MAX)
  } else if (typeof o.description === 'string') o.description = clip(o.description, DESC_MAX)
  if (o.id === undefined && type !== 'loading') o.id = `${type}:${title}`
  return [title, o]
}

const wrap = (type: 'success' | 'error' | 'info' | 'warning' | 'message' | 'loading') =>
  ((message: Title, opts?: ExternalToast) => {
    const [t, o] = tidy(type, message, opts)
    return type === 'message' ? base(t, o) : base[type](t, o)
  }) as (typeof base)['success']

const fn = ((message: Title, opts?: ExternalToast) => wrap('message')(message, opts)) as typeof base

export const toast = Object.assign(fn, {
  success: wrap('success'),
  error: wrap('error'),
  info: wrap('info'),
  warning: wrap('warning'),
  message: wrap('message'),
  loading: wrap('loading'),
  promise: base.promise,
  custom: base.custom,
  dismiss: base.dismiss,
  getHistory: base.getHistory,
  getToasts: base.getToasts,
}) as typeof base
