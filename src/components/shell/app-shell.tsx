'use client'

/**
 * App shell — the prototypeʼs floating shell: rounded frame on the canvas,
 * left icon rail (logo, Home / Watchlist / Settings with tooltips + badges,
 * Tor + theme at the bottom) and the topbar (dynamic view title, ⌘K search
 * box, Tor badge with text, bell with imminent-hearing notifications, "+" as
 * the solid quick-search action).
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import {
  Bell,
  Eye,
  Home,
  Moon,
  Plus,
  Search,
  Settings,
  CalendarClock,
  Sun,
} from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { watched } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { getTorStatus } from '@/lib/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

interface Notif {
  stir: string
  name?: string
  isoDate: string
  court?: string
  caseNumber?: string
  time?: string
  judge?: string
}

/** Watched companies' hearings within the 7-day alert window. */
function computeAlerts(): Notif[] {
  const out: Notif[] = []
  const now = Date.now()
  for (const w of watched()) {
    const iso = w.meta?.nextHearingIso
    if (!iso) continue
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) continue
    const t = new Date(y, m - 1, d).getTime()
    const days = Math.ceil((t - now) / 86_400_000)
    if (days >= 0 && days <= 7) {
      out.push({
        stir: w.stir,
        name: w.name,
        isoDate: iso,
        court: w.meta?.nextHearingCourt,
        caseNumber: w.meta?.nextHearingCase,
        time: w.meta?.nextHearingTime,
        judge: w.meta?.nextHearingJudge,
      })
    }
  }
  return out.sort((a, b) => a.isoDate.localeCompare(b.isoDate))
}

function RailNav({
  active,
  label,
  badge,
  onClick,
  children,
}: {
  active: boolean
  label: string
  badge?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button className={cn('rnav', active && 'active')} data-nav onClick={onClick} aria-label={label}>
      {children}
      {badge !== undefined && badge > 0 && <span className="rn-badge">{badge}</span>}
      <span className="tip">{label}</span>
    </button>
  )
}

function BellPopover() {
  const openCompany = useAppStore((s) => s.openCompany)
  const [open, setOpen] = useState(false)
  const rv = useRegistryVersion()
  const alerts = useMemo(() => computeAlerts(), [rv])
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside click closes the popover (prototype behavior)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  return (
    <div style={{ position: 'relative' }} ref={rootRef}>
      <button
        className="circ"
        title="Bildirishnomalar"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <Bell />
        {alerts.length > 0 && <span className="cbadge">{alerts.length}</span>}
      </button>
      {open && (
        <div className="pop" onClick={(e) => e.stopPropagation()}>
          <div className="pop-h">
            <b>Bildirishnomalar</b>
            {alerts.length > 0 && <span className="badge b-warn">{alerts.length}</span>}
          </div>
          <div className="pop-list">
            {alerts.length === 0 ? (
              <div className="empty" style={{ padding: 26 }}>
                <div className="ico">
                  <CalendarClock />
                </div>
                <h3>Bildirishnoma yoʻq</h3>
              </div>
            ) : (
              alerts.map((a, i) => {
                const [, m, d] = a.isoDate.split('-').map(Number)
                return (
                  <div
                    key={`${a.stir}-${i}`}
                    className="notif"
                    onClick={() => {
                      setOpen(false)
                      openCompany(a.stir, { name: a.name })
                      useAppStore.getState().setSection('hearings')
                    }}
                  >
                    <div className="ni b-warn">
                      <CalendarClock />
                    </div>
                    <div className="nt">
                      <b>
                        {(a.name || a.stir).slice(0, 18)} · majlis {d} {MONTHS[m - 1]}
                      </b>
                      <span>
                        {a.court || ''} · {a.time || ''} {a.judge ? `· ${a.judge}` : ''}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const view = useAppStore((s) => s.view)
  const surface = useAppStore((s) => s.surface)
  const goLauncher = useAppStore((s) => s.goLauncher)
  const setSurface = useAppStore((s) => s.setSurface)
  const setCommandOpen = useAppStore((s) => s.setCommandOpen)
  const setCommandPurpose = useAppStore((s) => s.setCommandPurpose)
  const { theme, setTheme } = useTheme()
  const [torState, setTorState] = useState<'checking' | 'active' | 'inactive'>('checking')
  // Post-hydration registry read via useSyncExternalStore: server snapshot is 0,
  // the client snapshot re-checks after hydration (no setState-in-effect).
  const watchCount = useSyncExternalStore(
    (cb) => {
      window.addEventListener('sud:registry-changed', cb)
      window.addEventListener('storage', cb)
      return () => {
        window.removeEventListener('sud:registry-changed', cb)
        window.removeEventListener('storage', cb)
      }
    },
    () => watched().length,
    () => 0,
  )

  // Tor status — poll lightly, refresh on demand
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await getTorStatus()
        if (alive && res.ok) setTorState(res.data.running ? 'active' : 'inactive')
      } catch {
        if (alive) setTorState('inactive')
      }
    }
    void poll()
    const t = setInterval(poll, 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const checkTor = () => {
    if (torState === 'active') {
      toast('Tor allaqachon faol')
      return
    }
    setTorState('checking')
    toast("Tor holati tekshirilmoqda…")
    void (async () => {
      try {
        const res = await getTorStatus()
        setTorState(res.ok && res.data.running ? 'active' : 'inactive')
        if (res.ok && res.data.running) toast.success('Tor faol')
        else toast.warning("Tor oʻchiq. Toʻlovlar soʻrovlari cheklangan boʻlishi mumkin")
      } catch {
        setTorState('inactive')
        toast.error('Tor holatini olib boʻlmadi')
      }
    })()
  }

  const torColor =
    torState === 'active' ? 'var(--pos-base)' : torState === 'inactive' ? 'var(--neg-base)' : 'var(--warn-base)'
  const torText = torState === 'active' ? 'Tor faol' : torState === 'inactive' ? "Tor oʻchiq" : 'Tor…'

  const title =
    surface === 'watchlist' ? 'Kuzatuv' : surface === 'settings' ? 'Sozlamalar' : view === 'company' ? 'Ish maydoni' : 'Bosh sahifa'

  return (
    <div className="shell">
      <aside className="rail" aria-label="Global navigatsiya">
        <div className="rail-logo" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 3 3 8l9 5 9-5-9-5Z" />
            <path d="M3 8v8l9 5 9-5V8" opacity=".55" />
          </svg>
        </div>
        <RailNav active={surface === 'main' && view === 'launcher'} label="Bosh sahifa" onClick={goLauncher}>
          <Home />
        </RailNav>
        <RailNav
          active={surface === 'watchlist'}
          label="Kuzatuv"
          badge={watchCount}
          onClick={() => setSurface(surface === 'watchlist' ? 'main' : 'watchlist')}
        >
          <Eye />
        </RailNav>
        <RailNav active={surface === 'settings'} label="Sozlamalar" onClick={() => setSurface('settings')}>
          <Settings />
        </RailNav>
        <div className="rail-sep" />
        <button className="rail-mini" title="Tor holati" onClick={checkTor}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v18M3.5 9h17M3.5 15h17" />
          </svg>
          <span className="tor-dot" style={{ background: torColor }} />
        </button>
        <button
          className="rail-mini"
          title="Mavzu"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Mavzu almashtirish"
        >
          {/* CSS-driven swap — no hydration mismatch */}
          <Sun className="theme-icon-light" style={{ width: 18, height: 18 }} />
          <Moon className="theme-icon-dark" style={{ width: 18, height: 18 }} />
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="top-title">{title}</div>
          <button
            className="searchbox"
            onClick={() => {
              setCommandPurpose('search')
              setCommandOpen(true)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span>STIR, ish raqami yoki kvitansiya boʻyicha qidiring…</span>
            <span className="kbd">
              <kbd>⌘</kbd>
              <kbd>K</kbd>
            </span>
          </button>
          <div className="top-right">
            <button className="tor-badge" onClick={checkTor} title="Tor holati">
              <span className="dot" style={{ background: torColor }} />
              <span>{torText}</span>
            </button>
            <BellPopover />
            <button
              className="circ solid"
              title="Yangi qidiruv"
              onClick={() => {
                setCommandPurpose('search')
                setCommandOpen(true)
              }}
            >
              <Plus />
            </button>
          </div>
        </header>
        <div className="scroll">
          <div className="page">{children}</div>
        </div>
      </div>
    </div>
  )
}
