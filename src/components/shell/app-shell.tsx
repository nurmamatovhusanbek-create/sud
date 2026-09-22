'use client'

/**
 * App shell — v18 layout (sud-tizimi-ui-v18.html): the 248px navy sidebar
 * (brand «Sud tizimi · by Nurmamatov», Ish maydoni nav group with Kuzatuv and
 * Statistika last, Tizim group, live worker sysstat footer) + the topbar
 * (menu button on mobile, ⌘K search, bell).
 *
 * v18 bell: each notification leads with the COUNTERPARTY company (matched
 * from the cached CompanyStats by case number) and a numeric DD.MM date.
 * Click still lands on the companyʼs Majlislar section.
 *
 * Tor status/check lives in Settings › Workerlar now, not here — it's
 * optional infrastructure (every scrape already routes through the CF
 * worker pool regardless of Tor), so it no longer occupies the topbar for
 * users who never set it up.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Eye,
  FileText,
  Gavel,
  Menu,
  Moon,
  Receipt,
  Settings,
  Sun,
} from 'lucide-react'
import { useAppStore, WORKSPACE_NAV, type SectionKey } from '@/lib/store/app-store'
import { useTabCounts } from '@/lib/tab-counts'
import { watched } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { getHealth } from '@/lib/api-client'
import { getCached } from '@/lib/cache'
import type { CompanyStats } from '@/lib/api-types'
import { cn } from '@/lib/utils'

const NAV_ICONS: Record<string, React.ReactNode> = {
  bills: <Receipt />,
  cases: <Gavel />,
  hearings: <CalendarDays />,
  profile: <Building2 />,
  kuzatuv: <Eye />,
  overview: <BarChart3 />,
}

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

const noopSubscribe = () => () => {}
/** Hydration probe — false on the server + first client render, true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

/**
 * v18: the alert title is the OTHER party of the case. We match the case
 * number inside the company's cached stats (10-min server memoization means
 * this is free); without a match we fall back to the watched company name.
 */
function counterpartyFor(stir: string, caseNumber?: string, fallback?: string): string {
  if (caseNumber) {
    const stats = getCached<CompanyStats>(`stats:${stir}`)
    const hit = stats?.cases?.find((c) => c.caseNumber === caseNumber)
    if (hit?.counterparty) return hit.counterparty
  }
  return fallback || `STIR ${stir}`
}

function BellPopover() {
  const openCompany = useAppStore((s) => s.openCompany)
  const [open, setOpen] = useState(false)
  const rv = useRegistryVersion()
  // v206: hydration gate — computeAlerts() reads the localStorage registry.
  const hydrated = useHydrated()
  const alerts = useMemo(() => (hydrated ? computeAlerts() : []), [rv, hydrated])
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside click closes the popover
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  return (
    <div className="bellwrap" ref={rootRef}>
      <button
        className="bell"
        title="Bildirishnomalar"
        aria-label="Bildirishnomalar"
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
                  <CalendarDays />
                </div>
                <h3>Bildirishnoma yoʻq</h3>
              </div>
            ) : (
              alerts.map((a, i) => {
                const [, m, d] = a.isoDate.split('-').map(Number)
                const ddmm = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
                const party = counterpartyFor(a.stir, a.caseNumber, a.name)
                return (
                  <div
                    key={`${a.stir}-${i}`}
                    className="notif"
                    onClick={() => {
                      setOpen(false)
                      openCompany(a.stir, { name: a.name }, 'hearings')
                    }}
                  >
                    <div className="ni b-warn">
                      <CalendarDays />
                    </div>
                    <div className="nt">
                      <b>{party}</b>
                      <span>
                        {ddmm} · {a.court || ''}
                        {a.time ? ` · ${a.time}` : ''}
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
  const section = useAppStore((s) => s.section)
  const surface = useAppStore((s) => s.surface)
  const company = useAppStore((s) => s.activeCompany)
  const goLauncher = useAppStore((s) => s.goLauncher)
  const setSurface = useAppStore((s) => s.setSurface)
  const setSection = useAppStore((s) => s.setSection)
  const setCommandOpen = useAppStore((s) => s.setCommandOpen)
  const setCommandPurpose = useAppStore((s) => s.setCommandPurpose)
  const { theme, setTheme } = useTheme()
  const [sideOpen, setSideOpen] = useState(false)
  const [workerStat, setWorkerStat] = useState<{ alive: number; total: number } | null>(null)
  // Post-hydration registry read via useSyncExternalStore: server snapshot is 0,
  // the client snapshot re-checks after hydration.
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
  const hydrated = useHydrated()
  const counts = useTabCountsSafe()

  // sysstat footer — light poll of the worker health summary
  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await getHealth()
        if (!res.ok) return
        const s = (res.data ?? {}) as { summary?: { activeWorkers?: number; totalWorkers?: number } }
        if (alive && s.summary && typeof s.summary.totalWorkers === 'number') {
          setWorkerStat({ alive: s.summary.activeWorkers ?? 0, total: s.summary.totalWorkers })
        }
      } catch {
        /* footer is cosmetic — stay silent */
      }
    }
    void poll()
    const t = setInterval(poll, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const inWorkspace = surface === 'main' && view === 'company' && !!company

  const goWorkspaceSection = (key: SectionKey) => {
    setSideOpen(false)
    // Inside a company workspace the tab just switches section (even when a
    // global surface like Kuzatuv/Sozlamalar is layered on top). From the
    // launcher (main menu) there is no company context to switch, so choose a
    // company first and land straight on the picked function.
    if (useAppStore.getState().view === 'company' && company) {
      setSurface('main')
      setSection(key)
      return
    }
    useAppStore.getState().setPendingSection(key)
    setCommandPurpose('search')
    setCommandOpen(true)
  }

  const navClick = (key: SectionKey | 'kuzatuv') => {
    if (key === 'kuzatuv') {
      setSideOpen(false)
      setSurface('watchlist')
      return
    }
    goWorkspaceSection(key)
  }

  const navActive = (key: SectionKey | 'kuzatuv') => {
    if (key === 'kuzatuv') return surface === 'watchlist'
    return inWorkspace && section === key
  }

  const pipFor = (key: SectionKey | 'kuzatuv'): number | undefined => {
    if (!hydrated) return undefined
    if (key === 'kuzatuv') return watchCount || undefined
    if (key === 'bills') return counts.bills
    if (key === 'cases') return counts.cases
    if (key === 'hearings') return counts.hearings
    return undefined
  }

  return (
    <div className="app-frame">
      <aside className={cn('side', sideOpen && 'open')} aria-label="Global navigatsiya">
        <button className="brand" onClick={goLauncher} aria-label="Bosh sahifa">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 4 7v5c0 4.5 3.2 7.9 8 9 4.8-1.1 8-4.5 8-9V7z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <span>
            <b>Sud tizimi</b>
            <span>by Nurmamatov</span>
          </span>
        </button>

        <div className="nav-label">Ish maydoni</div>
        <nav className="nav">
          {WORKSPACE_NAV.map((n) => (
            <button key={n.key} className={navActive(n.key) ? 'on' : ''} onClick={() => navClick(n.key)}>
              {NAV_ICONS[n.key]}
              {n.label}
              {pipFor(n.key) !== undefined && <span className="pip">{pipFor(n.key)}</span>}
            </button>
          ))}
        </nav>

        <div className="nav-label">Tizim</div>
        <nav className="nav">
          <button className={surface === 'documents' ? 'on' : ''} onClick={() => { setSideOpen(false); setSurface('documents') }}>
            <FileText />
            Hujjatlar
          </button>
          <button className={surface === 'settings' ? 'on' : ''} onClick={() => { setSideOpen(false); setSurface('settings') }}>
            <Settings />
            Sozlamalar
          </button>
        </nav>

        <div className="side-spacer" />
        <button className="sysstat" onClick={() => { setSideOpen(false); setSurface('settings') }}>
          <span className="pulse" />
          <span>
            <b>{workerStat ? `${workerStat.alive}/${workerStat.total} worker faol` : 'Workerlar tekshirilmoqda'}</b>
            <small>Tarmoq holati · sogʻlom</small>
          </span>
        </button>
        <div className="side-foot">
          <button
            className="rail-mini"
            title="Mavzu"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Mavzu almashtirish"
          >
            <Sun className="theme-icon-light" style={{ width: 18, height: 18 }} />
            <Moon className="theme-icon-dark" style={{ width: 18, height: 18 }} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menyu" onClick={() => setSideOpen((o) => !o)}>
            <Menu style={{ width: 18, height: 18 }} />
          </button>
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
            <BellPopover />
          </div>
        </header>
        <div className="scroll">
          <div className="page">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** useTabCounts with a STABLE cached snapshot (getSnapshot must not return a
 *  fresh object per call — that spins useSyncExternalStore into an infinite
 *  re-render loop and crashes the app). */
const EMPTY_COUNTS: { bills?: number; cases?: number; hearings?: number } = {}
let tabCountsSnap: { bills?: number; cases?: number; hearings?: number } = EMPTY_COUNTS
function useTabCountsSafe(): { bills?: number; cases?: number; hearings?: number } {
  return useSyncExternalStore(subscribeTabCounts, getTabCountsSnap, () => EMPTY_COUNTS)
}
function subscribeTabCounts(cb: () => void): () => void {
  return useTabCounts.subscribe(cb)
}
function getTabCountsSnap(): { bills?: number; cases?: number; hearings?: number } {
  const s = useTabCounts.getState()
  if (s.bills !== tabCountsSnap.bills || s.cases !== tabCountsSnap.cases || s.hearings !== tabCountsSnap.hearings) {
    tabCountsSnap = { bills: s.bills, cases: s.cases, hearings: s.hearings }
  }
  return tabCountsSnap
}
