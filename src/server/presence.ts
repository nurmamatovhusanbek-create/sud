/**
 * Which browser windows of the app are open right now — in memory, on globalThis (a route bundle must see the same copy).
 *
 * Each page sends a ping every 30 s and a «bye» when it is closed (components/shell/presence-beat). When the app was
 * started by Sud.bat (SUD_AUTO_EXIT=1) the supervisor asks GET /api/presence and shuts the whole server down once no
 * window has been open for a minute (scripts/boot-helpers.mjs › shouldStop). Nothing here records WHAT anyone did.
 *
 *  - A window that closed cleanly says «bye»: it is forgotten at once.
 *  - A window that vanished without saying it (browser killed, tab frozen) is forgotten after TAB_STALE_MS.
 *  - Never-opened: `everSeen` stays false, so a server nobody has opened is judged by its uptime instead.
 */

export const TAB_STALE_MS = 20 * 60_000
const MAX_TABS = 50 // ids come from the client: never let the map grow without bound

interface State {
  startedAt: number
  tabs: Map<string, number> // id → last ping
  everSeen: boolean
  lastActivity: number
}

const G = globalThis as typeof globalThis & { __sudPresence?: State }

export function presenceState(now = Date.now()): State {
  return (G.__sudPresence ??= { startedAt: now, tabs: new Map(), everSeen: false, lastActivity: now })
}

function prune(s: State, now: number): void {
  for (const [id, at] of s.tabs) if (now - at > TAB_STALE_MS) s.tabs.delete(id)
  while (s.tabs.size > MAX_TABS) s.tabs.delete(s.tabs.keys().next().value as string)
}

export function recordBeat(id: string, now = Date.now(), s = presenceState(now)): void {
  s.tabs.delete(id) // re-insert: Map order = least recently pinged first
  s.tabs.set(id, now)
  s.everSeen = true
  s.lastActivity = now
  prune(s, now)
}

export function recordBye(id: string, now = Date.now(), s = presenceState(now)): void {
  s.tabs.delete(id)
  s.everSeen = true
  s.lastActivity = now
}

export interface PresenceSnapshot {
  openTabs: number
  /** how long nobody has had the app open (0 while a window is open) */
  idleMs: number
  /** a window has been seen since this server started */
  everSeen: boolean
  uptimeMs: number
}

export function presenceSnapshot(now = Date.now(), s = presenceState(now)): PresenceSnapshot {
  prune(s, now)
  const openTabs = s.tabs.size
  return { openTabs, idleMs: openTabs > 0 ? 0 : Math.max(0, now - s.lastActivity), everSeen: s.everSeen, uptimeMs: Math.max(0, now - s.startedAt) }
}
