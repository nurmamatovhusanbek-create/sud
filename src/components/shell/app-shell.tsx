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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Sun,
} from 'lucide-react'
import { useAppStore, WORKSPACE_NAV, type SectionKey } from '@/lib/store/app-store'
import { useTabCounts } from '@/lib/tab-counts'
import { watched } from '@/lib/registry'
import { getHealth } from '@/lib/api-client'
import { ddmm, counterpartyFor, useAlerts, useHydrated } from './alerts'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { BrandMark } from '@/components/proto/brand-mark'
import { GreenShell, type GxNavItem } from '@/components/greenui/shell'
import { setSideMini, useSideMini, useUiVersion } from '@/lib/ui-version'
import { usesRebuiltScreens } from '@/core/ui-version'

const NAV_ICONS: Record<string, React.ReactNode> = {
  bills: <Receipt />,
  cases: <Gavel />,
  hearings: <CalendarDays />,
  profile: <Building2 />,
  kuzatuv: <Eye />,
  overview: <BarChart3 />,
}

/** The green look's page title and its one-line tagline (the top bar names the page the way the sidebar does). */
const PAGE_TAGLINES: Record<string, string> = {
  home: 'Kompaniyalar, majlislar va qarzdorlik — bir qarashda.',
  watchlist: 'Kuzatuvdagi kompaniyalar, ularning majlislari va qarzdorligi.',
  documents: 'Viza, sud va boshqa hujjatlarni tayyor shablonlar asosida yarating.',
  settings: 'Yangilanishlar, workerlar, captcha va koʻrinishni boshqaring.',
  bills: 'Kvitansiyalar, toʻlovlar va muddati oʻtgan qarz.',
  cases: 'Kompaniyaning barcha sud ishlari va ularning natijasi.',
  hearings: 'Rejalashtirilgan sud majlislari kunma-kun.',
  profile: 'Kompaniya haqida rasmiy maʼlumotlar va reyting.',
  overview: 'Yutuq, reyting va sud ishlari statistikasi.',
}

function BellPopover() {
  const openCompany = useAppStore((s) => s.openCompany)
  const [open, setOpen] = useState(false)
  const alerts = useAlerts()
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
                        {ddmm(a.isoDate)} · {a.court || ''}
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
  // the registry could not be saved (browser storage full): say so once instead of losing changes silently
  useEffect(() => {
    let told = false
    const onFull = () => {
      if (told) return
      told = true
      toast.warning('Brauzer xotirasi toʻlgan', { description: 'Oxirgi oʻzgarish saqlanmadi. Brauzer sozlamalarida sayt maʼlumotlarini tozalang yoki kuzatuvdagi kompaniyalarni kamaytiring.' })
    }
    window.addEventListener('sud:storage-full', onFull)
    return () => window.removeEventListener('sud:storage-full', onFull)
  }, [])
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
  // New look only: the sidebar can fold to an icon rail (CSS reads html[data-side]); labels then live in tooltips.
  const ui = useUiVersion()
  const mini = useSideMini() && ui === 'new'
  // Escape closes the drawer (it covers its own hamburger; the scrim also closes it).
  useEffect(() => {
    if (!sideOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSideOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sideOpen])
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
  const pageKey = surface === 'main' ? (inWorkspace ? section : 'home') : surface
  const pageTitle = pageKey === 'home' ? 'Bosh sahifa' : pageKey === 'watchlist' ? 'Kuzatuv' : pageKey === 'documents' ? 'Hujjatlar' : pageKey === 'settings' ? 'Sozlamalar' : (WORKSPACE_NAV.find((n) => n.key === pageKey)?.label ?? 'Sud tizimi')

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

  if (ui === 'green') {
    const mk = (key: SectionKey | 'kuzatuv'): GxNavItem => {
      const label = key === 'kuzatuv' ? 'Kuzatuv' : (WORKSPACE_NAV.find((n) => n.key === key)?.label ?? key)
      return { key, label, icon: NAV_ICONS[key], active: navActive(key), pip: pipFor(key), onClick: () => navClick(key) }
    }
    const sys = (key: 'documents' | 'settings', label: string, icon: React.ReactNode): GxNavItem => ({
      key, label, icon, active: surface === key, onClick: () => { setSideOpen(false); setSurface(key) },
    })
    return (
      <GreenShell
        workspace={{ name: inWorkspace && company ? company.name || `STIR ${company.stir}` : null, stir: inWorkspace && company ? company.stir : null, onClick: () => { setSideOpen(false); goLauncher() } }}
        work={WORKSPACE_NAV.map((n) => mk(n.key))}
        system={[sys('documents', 'Hujjatlar', <FileText />), sys('settings', 'Sozlamalar', <Settings />)]}
        workerStat={workerStat}
        onWorkers={() => { setSideOpen(false); setSurface('settings') }}
        dark={theme === 'dark'}
        onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={pageTitle}
        tagline={PAGE_TAGLINES[pageKey] ?? ''}
        showSearch
        onSearch={() => { setCommandPurpose('search'); setCommandOpen(true) }}
        sideOpen={sideOpen}
        setSideOpen={setSideOpen}
        onHome={() => { setSideOpen(false); goLauncher() }}
      >
        {children}
      </GreenShell>
    )
  }

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main">Asosiy qismga oʻtish</a>
      {sideOpen && <div className="side-scrim" onClick={() => setSideOpen(false)} aria-hidden />}
      <aside className={cn('side', sideOpen && 'open')} aria-label="Global navigatsiya">
        <button className="brand" onClick={goLauncher} aria-label="Bosh sahifa">
          <span className="logo" aria-hidden>
            <BrandMark />
          </span>
          <span>
            <b>Sud tizimi</b>
            <span>by Nurmamatov</span>
          </span>
        </button>

        <div className="nav-label">Ish maydoni</div>
        <nav className="nav" aria-label="Ish maydoni">
          {WORKSPACE_NAV.map((n) => (
            <button key={n.key} className={navActive(n.key) ? 'on' : ''} onClick={() => navClick(n.key)} title={mini ? n.label : undefined}>
              {NAV_ICONS[n.key]}
              <span className="nl">{n.label}</span>
              {pipFor(n.key) !== undefined && <span className="pip">{pipFor(n.key)}</span>}
            </button>
          ))}
        </nav>

        <div className="nav-label">Tizim</div>
        <nav className="nav" aria-label="Tizim">
          <button className={surface === 'documents' ? 'on' : ''} onClick={() => { setSideOpen(false); setSurface('documents') }} title={mini ? 'Hujjatlar' : undefined}>
            <FileText />
            <span className="nl">Hujjatlar</span>
          </button>
          <button className={surface === 'settings' ? 'on' : ''} onClick={() => { setSideOpen(false); setSurface('settings') }} title={mini ? 'Sozlamalar' : undefined}>
            <Settings />
            <span className="nl">Sozlamalar</span>
          </button>
        </nav>

        <div className="side-spacer" />
        <button className="sysstat" onClick={() => { setSideOpen(false); setSurface('settings') }} title={mini && workerStat ? `${workerStat.alive}/${workerStat.total} worker faol` : undefined}>
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
          {ui === 'new' && (
            <button
              className="rail-mini side-fold"
              title={mini ? 'Menyuni yoyish' : 'Menyuni yigʻish'}
              aria-label={mini ? 'Menyuni yoyish' : 'Menyuni yigʻish'}
              aria-pressed={mini}
              onClick={() => setSideMini(!mini)}
            >
              {mini ? <PanelLeftOpen style={{ width: 18, height: 18 }} /> : <PanelLeftClose style={{ width: 18, height: 18 }} />}
            </button>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menyu" onClick={() => setSideOpen((o) => !o)}>
            <Menu style={{ width: 18, height: 18 }} />
          </button>
          {usesRebuiltScreens(ui) || (surface !== 'documents' && surface !== 'settings') ? (
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
          ) : (
            <div style={{ flex: 1 }} />
          )}
          <div className="top-right">
            <BellPopover />
          </div>
        </header>
        <div className="scroll">
          <main className="page" id="main">{children}</main>
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
