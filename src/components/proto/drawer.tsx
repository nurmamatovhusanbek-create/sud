'use client'

/**
 * Proto drawer — the right-side sheet used for case details, receipts and
 * worker inspection. A tiny module store lets any view open it without prop
 * drilling.
 *
 * Its look follows the themed PDF (src/lib/print.ts): a branded masthead, an
 * eyebrow + large title block, uppercase accent section labels with a rule,
 * zebra key/value rows, and an accent-soft key-figure block. Callers compose
 * the body from the Dw* building blocks below, so every panel matches.
 *
 * PERFORMANCE: do NOT add `backdrop-filter` to the scrim. Combined with any
 * animation on the page beneath it, the browser re-blurs the whole viewport
 * every frame (measured: 60 → ~25 fps with the drawer open). A plain
 * semi-opaque scrim looks the same and costs nothing.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { BrandMark } from './brand-mark'

export interface DrawerOpts {
  /** small uppercase label in the masthead, e.g. «Ish tafsiloti» */
  eyebrow?: string
  /** pills under the title (status, type, …) */
  badges?: React.ReactNode
  /** sticky action row at the bottom */
  footer?: React.ReactNode
  /**
   * DOCK it beside the list instead of sliding over it (screens wide enough, see DOCK_QUERY): no scrim, nothing dims, the list stays
   * usable and the open row is marked. Case details and receipts are list + detail, so the reader steps through them; the other
   * drawers (worker health, orders, ⌘K results) stay slide-overs.
   */
  dock?: boolean
  /** which list row this detail belongs to (the list marks it) */
  rowKey?: string
  /** step to the previous / next row: shown as two buttons and bound to ↑ ↓ and k j while docked */
  nav?: { pos: string; prev?: () => void; next?: () => void }
}

interface DrawerState extends DrawerOpts {
  open: boolean
  title: React.ReactNode
  sub?: string
  content: React.ReactNode
  show: (title: React.ReactNode, content: React.ReactNode, sub?: string, opts?: DrawerOpts) => void
  hide: () => void
}

export const useDrawer = create<DrawerState>((set) => ({
  open: false,
  title: null,
  sub: undefined,
  content: null,
  eyebrow: undefined,
  badges: undefined,
  footer: undefined,
  dock: undefined,
  rowKey: undefined,
  nav: undefined,
  // Every field is replaced on each show(), so a loading → loaded swap never
  // leaves stale badges or a stale footer behind.
  show: (title, content, sub, opts) =>
    set({ open: true, title, content, sub, eyebrow: opts?.eyebrow, badges: opts?.badges, footer: opts?.footer, dock: opts?.dock, rowKey: opts?.rowKey, nav: opts?.nav }),
  hide: () => set({ open: false }),
}))

export function openProtoDrawer(title: React.ReactNode, content: React.ReactNode, sub?: string, opts?: DrawerOpts) {
  useDrawer.getState().show(title, content, sub, opts)
}
export function closeProtoDrawer() {
  useDrawer.getState().hide()
}

/** a docked detail needs room for the list beside it: below this the drawer slides over, as before */
const DOCK_QUERY = '(min-width: 1360px)'
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(DOCK_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(DOCK_QUERY).matches,
    () => false,
  )

/** the row key of the open DOCKED detail (undefined when closed or sliding), for the list to mark its row */
export function useDockedRowKey(): string | undefined {
  const wide = useWide()
  return useDrawer((s) => (s.open && s.dock && wide ? s.rowKey : undefined))
}

export function ProtoDrawer() {
  const open = useDrawer((s) => s.open)
  const title = useDrawer((s) => s.title)
  const sub = useDrawer((s) => s.sub)
  const content = useDrawer((s) => s.content)
  const eyebrow = useDrawer((s) => s.eyebrow)
  const badges = useDrawer((s) => s.badges)
  const footer = useDrawer((s) => s.footer)
  const dockOpt = useDrawer((s) => s.dock)
  const rowKey = useDrawer((s) => s.rowKey)
  const nav = useDrawer((s) => s.nav)
  const hide = useDrawer((s) => s.hide)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wide = useWide()
  const docked = !!dockOpt && wide

  // Esc closes. A sliding drawer is modal: focus moves into it. A DOCKED one is not (the list beside it stays usable): focus stays
  // where it was, and ↑ ↓ / k j step through the list's rows unless the reader is typing.
  useEffect(() => {
    if (!open) return
    if (!docked) closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return hide()
      if (!docked || !nav || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        nav.next?.()
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        nav.prev?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, hide, docked, nav])

  // a docked detail takes a column from the page: the page's scroller gets a right margin (data-dock on <html>), below the topbar
  useEffect(() => {
    const root = document.documentElement
    if (!(open && docked)) {
      root.removeAttribute('data-dock')
      return
    }
    const bar = document.querySelector<HTMLElement>('.topbar')
    root.style.setProperty('--topbar-h', `${bar ? Math.round(bar.getBoundingClientRect().height) : 71}px`)
    root.setAttribute('data-dock', 'open')
    return () => root.removeAttribute('data-dock')
  }, [open, docked])

  return (
    <>
      {docked ? null : <div className={`drawer-scrim ${open ? 'open' : ''}`} onClick={hide} />}
      <aside
        className={`drawer ${open ? 'open' : ''}${docked ? ' dock' : ''}`}
        role={docked ? 'complementary' : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-label={docked ? 'Tafsilot' : undefined}
        aria-hidden={!open}
      >
        <div className="drawer-mast">
          <span className="logo" aria-hidden><BrandMark /></span>
          <span className="eb">{eyebrow || 'Sud tizimi'}</span>
          {docked && nav ? (
            <span className="dw-nav">
              <span className="pos mono" aria-live="polite">{nav.pos}</span>
              <button className="x" onClick={nav.prev} disabled={!nav.prev} aria-label="Oldingi (↑)" title="Oldingi (↑ yoki k)"><ChevronUp /></button>
              <button className="x" onClick={nav.next} disabled={!nav.next} aria-label="Keyingi (↓)" title="Keyingi (↓ yoki j)"><ChevronDown /></button>
            </span>
          ) : null}
          <button ref={closeRef} className="x" onClick={hide} aria-label="Yopish (Esc)" title="Yopish (Esc)">
            <X />
          </button>
        </div>
        {/* re-keyed per row: stepping to another case re-plays the short fade-and-rise instead of a blind swap */}
        <div className="drawer-swap" key={docked ? (rowKey ?? 'x') : 'slide'}>
          <div className="drawer-title">
            <h2>{title}</h2>
            {sub ? <div className="sub">{sub}</div> : null}
            {badges ? <div className="badges">{badges}</div> : null}
          </div>
          <div className="drawer-body">{content}</div>
        </div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  )
}

// ---- building blocks -------------------------------------------------------

/** Uppercase accent label + hairline rule, with an optional count. */
export function DwSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="dw-sec">
      <div className="dw-sec-h">
        <span>{title}</span>
        {count !== undefined ? <span className="n">{count}</span> : null}
      </div>
      {children}
    </section>
  )
}

export type DwRow = [label: string, value: React.ReactNode, opts?: { mono?: boolean; tone?: 'neg' | 'pos' }]

const isBlank = (v: React.ReactNode) =>
  v === null || v === undefined || v === false || (typeof v === 'string' && (v.trim() === '' || v.trim() === '-' || v.trim() === '—'))

/** Zebra key/value list. Rows with no value are dropped — a «-» row is noise. */
export function DwKv({ rows }: { rows: DwRow[] }) {
  const shown = rows.filter(([, v]) => !isBlank(v))
  if (!shown.length) return null
  return (
    <div className="dw-kv">
      {shown.map(([k, v, o], i) => (
        <div key={`${i}:${k}`}>
          <span className="k">{k}</span>
          <span className={`v${o?.mono ? ' mono' : ''}${o?.tone ? ` ${o.tone}` : ''}`}>{v}</span>
        </div>
      ))}
    </div>
  )
}

/** The one number that matters, on an accent-soft block (the PDF's total). */
export function DwFig({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <div className="dw-fig">
      <span className="k">{label}</span>
      <span className="v">{value}{unit ? <small>{unit}</small> : null}</span>
    </div>
  )
}
