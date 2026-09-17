'use client'

/**
 * Proto drawer — the prototype's right-side sheet (.drawer) with scrim, used
 * for receipts, case details, comparison and worker inspection. A tiny module
 * store lets any view open it without prop drilling.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'

interface DrawerState {
  open: boolean
  title: React.ReactNode
  sub?: string
  content: React.ReactNode
  show: (title: React.ReactNode, content: React.ReactNode, sub?: string) => void
  hide: () => void
}

export const useDrawer = create<DrawerState>((set) => ({
  open: false,
  title: null,
  sub: undefined,
  content: null,
  show: (title, content, sub) => set({ open: true, title, content, sub }),
  hide: () => set({ open: false }),
}))

export function openProtoDrawer(title: React.ReactNode, content: React.ReactNode, sub?: string) {
  useDrawer.getState().show(title, content, sub)
}
export function closeProtoDrawer() {
  useDrawer.getState().hide()
}

export function ProtoDrawer() {
  const open = useDrawer((s) => s.open)
  const title = useDrawer((s) => s.title)
  const sub = useDrawer((s) => s.sub)
  const content = useDrawer((s) => s.content)
  const hide = useDrawer((s) => s.hide)

  // Esc closes (page-level handler also closes palette — guard here too)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, hide])

  return (
    <>
      <div className={`drawer-scrim ${open ? 'open' : ''}`} onClick={hide} />
      <aside className={`drawer ${open ? 'open' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer-h">
          <div className="dt">
            {title}
            {sub ? <span>{sub}</span> : null}
          </div>
          <button className="circ sm" onClick={hide} aria-label="Yopish">
            <X />
          </button>
        </div>
        <div className="drawer-body">{content}</div>
      </aside>
    </>
  )
}
