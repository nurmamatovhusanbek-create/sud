'use client'

/**
 * «Yashil» shell — its own markup, not the classic sidebar restyled.
 *
 * A framed panel: on the left a column with the round brand, a workspace card (the open company, or all of them),
 * the menu where the CURRENT page is a white pill, and a status card at the bottom (worker count, theme); on the right
 * the page title with its tagline, a pill search and the bell. All state lives in AppShell and arrives as props, so the
 * three looks always read the same data. Classes are `gx-*` and styled only by ui-green.css.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Bell, CalendarDays, Menu, Moon, Search, Sun } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { initials } from '@/components/proto/primitives'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/proto/brand-mark'
import { counterpartyFor, ddmm, useAlerts } from '@/components/shell/alerts'

export interface GxNavItem {
  key: string
  label: string
  icon: ReactNode
  active: boolean
  /** a small count on the right (watched companies, bills…) */
  pip?: number
  onClick: () => void
}

export interface GxWorkspace {
  /** the open company; null on the launcher and on global pages */
  name: string | null
  stir: string | null
  onClick: () => void
}

interface Props {
  workspace: GxWorkspace
  work: GxNavItem[]
  system: GxNavItem[]
  workerStat: { alive: number; total: number } | null
  onWorkers: () => void
  dark: boolean
  onTheme: () => void
  title: string
  tagline: string
  showSearch: boolean
  onSearch: () => void
  sideOpen: boolean
  setSideOpen: (open: boolean) => void
  onHome: () => void
  children: ReactNode
}

function Pip({ n }: { n?: number }) {
  return n === undefined ? null : <span className="gx-pip">{n}</span>
}

function Item({ it }: { it: GxNavItem }) {
  return (
    <button className={cn('gx-item', it.active && 'on')} aria-current={it.active ? 'page' : undefined} onClick={it.onClick}>
      {it.icon}
      <span>{it.label}</span>
      <Pip n={it.pip} />
    </button>
  )
}

/** The bell: a round button with a count, opening a small list of this week's hearings. */
export function GreenBell() {
  const openCompany = useAppStore((s) => s.openCompany)
  const alerts = useAlerts()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="gx-bellwrap" ref={root}>
      <button className="gx-round" title="Bildirishnomalar" aria-label="Bildirishnomalar" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        <Bell />
        {alerts.length > 0 && <span className="gx-badge">{alerts.length}</span>}
      </button>
      {open && (
        <div className="gx-pop" onClick={(e) => e.stopPropagation()}>
          <div className="gx-pop-h">
            <b>Yaqin majlislar</b>
            <span>7 kun ichida</span>
          </div>
          <div className="gx-pop-list">
            {alerts.length === 0 ? (
              <div className="gx-pop-empty">
                <CalendarDays />
                <span>Bildirishnoma yoʻq</span>
              </div>
            ) : (
              alerts.map((a, i) => (
                <button
                  key={`${a.stir}-${i}`}
                  className="gx-note"
                  onClick={() => {
                    setOpen(false)
                    openCompany(a.stir, { name: a.name }, 'hearings')
                  }}
                >
                  <span className="gx-note-date">{ddmm(a.isoDate)}</span>
                  <span className="gx-note-body">
                    <b>{counterpartyFor(a.stir, a.caseNumber, a.name)}</b>
                    <small>
                      {a.court || ''}
                      {a.time ? ` · ${a.time}` : ''}
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function GreenShell(p: Props) {
  const { workspace: ws } = p
  return (
    <div className="gx-frame">
      <a className="skip-link" href="#main">Asosiy qismga oʻtish</a>
      {p.sideOpen && <div className="gx-scrim" onClick={() => p.setSideOpen(false)} aria-hidden />}
      <aside className={cn('gx-side', p.sideOpen && 'open')} aria-label="Global navigatsiya">
        <button className="gx-brand" onClick={p.onHome} aria-label="Bosh sahifa">
          <span className="gx-logo" aria-hidden>
            <BrandMark />
          </span>
          <span className="gx-brand-t">
            <b>Sud tizimi</b>
            <small>by Nurmamatov</small>
          </span>
        </button>

        <button className={cn('gx-ws', ws.name && 'on')} onClick={ws.onClick} title={ws.name ? 'Kompaniyani yopib, Bugunga qaytish' : 'Kompaniyani qidirish'}>
          <span className={cn('gx-ws-av', !ws.name && 'all')}>{ws.name ? initials(ws.name) : 'SH'}</span>
          <span className="gx-ws-t">
            <small>{ws.name ? 'Ochiq kompaniya' : 'Kompaniya tanlanmagan'}</small>
            <b>{ws.name ?? 'Qidirish yoki tanlash'}</b>
          </span>
          <span className="gx-ws-chev" aria-hidden>⌄</span>
        </button>

        <div className="gx-label">Joylar</div>
        <nav className="gx-nav" aria-label="Joylar">
          {p.work.map((it) => (
            <Item key={it.key} it={it} />
          ))}
        </nav>

        <div className="gx-label">Tizim</div>
        <nav className="gx-nav" aria-label="Tizim">
          {p.system.map((it) => (
            <Item key={it.key} it={it} />
          ))}
        </nav>

        <div className="gx-grow" />
        <div className="gx-status">
          <span className="gx-status-dot" aria-hidden />
          <span className="gx-status-t">
            <b>{p.workerStat ? `${p.workerStat.alive}/${p.workerStat.total} worker faol` : 'Workerlar tekshirilmoqda'}</b>
            <small>Tarmoq holati</small>
          </span>
          <button className="gx-status-go" onClick={p.onWorkers}>Sozlash</button>
          <button className="gx-round sm" title="Mavzu" aria-label="Mavzu almashtirish" onClick={p.onTheme}>
            {p.dark ? <Sun /> : <Moon />}
          </button>
        </div>
      </aside>

      <div className="gx-main">
        <header className="gx-top">
          <button className="gx-round gx-menu" aria-label="Menyu" onClick={() => p.setSideOpen(!p.sideOpen)}>
            <Menu />
          </button>
          <div className="gx-title">
            <b>{p.title}</b>
            <span>{p.tagline}</span>
          </div>
          {p.showSearch && (
            <button className="gx-search" onClick={p.onSearch}>
              <Search />
              <span>STIR, ish raqami yoki kvitansiya boʻyicha qidiring…</span>
              <span className="gx-kbd">
                <kbd>⌘</kbd>
                <kbd>K</kbd>
              </span>
            </button>
          )}
          <GreenBell />
        </header>
        <div className="gx-scroll">
          <main className="gx-page" id="main">{p.children}</main>
        </div>
      </div>
    </div>
  )
}
