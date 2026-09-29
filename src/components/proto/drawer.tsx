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

import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { ShieldCheck, X } from 'lucide-react'

export interface DrawerOpts {
  /** small uppercase label in the masthead, e.g. «Ish tafsiloti» */
  eyebrow?: string
  /** pills under the title (status, type, …) */
  badges?: React.ReactNode
  /** sticky action row at the bottom */
  footer?: React.ReactNode
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
  // Every field is replaced on each show(), so a loading → loaded swap never
  // leaves stale badges or a stale footer behind.
  show: (title, content, sub, opts) =>
    set({ open: true, title, content, sub, eyebrow: opts?.eyebrow, badges: opts?.badges, footer: opts?.footer }),
  hide: () => set({ open: false }),
}))

export function openProtoDrawer(title: React.ReactNode, content: React.ReactNode, sub?: string, opts?: DrawerOpts) {
  useDrawer.getState().show(title, content, sub, opts)
}
export function closeProtoDrawer() {
  useDrawer.getState().hide()
}

export function ProtoDrawer() {
  const open = useDrawer((s) => s.open)
  const title = useDrawer((s) => s.title)
  const sub = useDrawer((s) => s.sub)
  const content = useDrawer((s) => s.content)
  const eyebrow = useDrawer((s) => s.eyebrow)
  const badges = useDrawer((s) => s.badges)
  const footer = useDrawer((s) => s.footer)
  const hide = useDrawer((s) => s.hide)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Esc closes; focus moves into the dialog on open (it is aria-modal).
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, hide])

  return (
    <>
      <div className={`drawer-scrim ${open ? 'open' : ''}`} onClick={hide} />
      <aside className={`drawer ${open ? 'open' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>
        <div className="drawer-mast">
          <span className="logo" aria-hidden><ShieldCheck /></span>
          <span className="eb">{eyebrow || 'Sud tizimi'}</span>
          <button ref={closeRef} className="x" onClick={hide} aria-label="Yopish">
            <X />
          </button>
        </div>
        <div className="drawer-title">
          <h2>{title}</h2>
          {sub ? <div className="sub">{sub}</div> : null}
          {badges ? <div className="badges">{badges}</div> : null}
        </div>
        <div className="drawer-body">{content}</div>
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
      {shown.map(([k, v, o]) => (
        <div key={k}>
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
