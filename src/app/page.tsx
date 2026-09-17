'use client'

/**
 * Sud Signal — app root.
 *
 * Views mirror the prototypeʼs four surfaces: home (launcher), company
 * workspace (context bar + section tabs), watchlist, settings — hosted on the
 * single `/` route with in-app state (the guides' sanctioned interim).
 * The prototype drawer (receipt / case / compare) mounts globally.
 *
 * Keyboard model (§7.4): ⌘K/⌘F palette · / palette · 1–5 sections ·
 * R refresh · E export · Esc close.
 */

import { useEffect, useState } from 'react'
import { BarChart3, CalendarDays, Gavel, Receipt, Building2 } from 'lucide-react'
import { AppShell } from '@/components/shell/app-shell'
import { CommandPalette } from '@/components/shell/command-palette'
import { ProtoDrawer } from '@/components/proto/drawer'
import { Launcher } from '@/components/views/launcher'
import { WatchlistView } from '@/components/views/watchlist'
import { SettingsView } from '@/components/views/settings-view'
import { ContextBar } from '@/components/company/context-bar'
import { OverviewSection } from '@/components/sections/overview'
import { BillsSection } from '@/components/sections/bills'
import { CasesSection } from '@/components/sections/cases'
import { HearingsSection } from '@/components/sections/hearings'
import { ProfileSection } from '@/components/sections/profile'
import { useAppStore, SECTIONS, type SectionKey } from '@/lib/store/app-store'
import { exportStatsXlsx, getStats } from '@/lib/api-client'
import { useTabCounts } from '@/lib/tab-counts'
import { toast } from 'sonner'
import { keepIdentityWarm } from '@/lib/identity'

const SECTION_ICONS: Record<SectionKey, React.ReactNode> = {
  overview: <BarChart3 />,
  bills: <Receipt />,
  cases: <Gavel />,
  hearings: <CalendarDays />,
  profile: <Building2 />,
}

/** Workspace: context bar + section tabs + the active section. */
function CompanyWorkspace() {
  const company = useAppStore((s) => s.activeCompany)
  const section = useAppStore((s) => s.section)
  const setSection = useAppStore((s) => s.setSection)
  const counts = useTabCounts()
  // Adjust-state-during-render pattern (React docs): no effect needed.
  const [prevSection, setPrevSection] = useState<SectionKey>(section)
  const [visited, setVisited] = useState<Set<SectionKey>>(() => new Set(['overview' as SectionKey]))
  if (prevSection !== section) {
    setPrevSection(section)
    setVisited((v) => new Set(v).add(section))
  }

  // Keyboard model: 1–5 sections, R refresh, E export
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const idx = Number(e.key)
      if (idx >= 1 && idx <= SECTIONS.length) {
        setSection(SECTIONS[idx - 1].key)
      }
      if (e.key.toLowerCase() === 'r') {
        window.dispatchEvent(new CustomEvent('sud:force-section'))
      }
      if (e.key.toLowerCase() === 'e') {
        window.dispatchEvent(new CustomEvent('sud:export-active'))
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [setSection])

  // E — export the active companyʼs stats workbook
  useEffect(() => {
    const handler = () => {
      const stir = useAppStore.getState().activeCompany?.stir
      if (!stir) return
      toast('Eksport tayyorlanmoqda…')
      void (async () => {
        try {
          const res = await getStats(stir)
          if (res.ok) {
            await exportStatsXlsx({ tin: stir, stats: res.data })
            toast.success('Excel yuklab olindi')
          } else toast.error(res.error)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Eksport xatosi')
        }
      })()
    }
    window.addEventListener('sud:export-active', handler)
    return () => window.removeEventListener('sud:export-active', handler)
  }, [])

  if (!company) return null

  const tabCount = (key: SectionKey): number | undefined => {
    if (key === 'bills') return counts.bills
    if (key === 'cases') return counts.cases
    if (key === 'hearings') return counts.hearings
    return undefined
  }

  return (
    <div>
      <ContextBar />

      {/* Section tabs — the prototypeʼs underline rail with number, icon, count */}
      <div className="tabs">
        {SECTIONS.map((s, i) => {
          const c = tabCount(s.key)
          return (
            <button key={s.key} className={`tab ${section === s.key ? 'active' : ''}`} data-sec={s.key} onClick={() => setSection(s.key)}>
              <span className="tnum">{i + 1}</span>
              {SECTION_ICONS[s.key]}
              <span>{s.label}</span>
              {c !== undefined && c > 0 && <span className="tc">{c}</span>}
              <span className="ind" />
            </button>
          )
        })}
      </div>

      {/* Section content — lazy mount on first visit, then keep alive */}
      <div>
        {visited.has('overview') && (
          <div style={{ display: section === 'overview' ? 'block' : 'none' }}>
            <OverviewSection />
          </div>
        )}
        {visited.has('bills') && (
          <div style={{ display: section === 'bills' ? 'block' : 'none' }}>
            <BillsSection />
          </div>
        )}
        {visited.has('cases') && (
          <div style={{ display: section === 'cases' ? 'block' : 'none' }}>
            <CasesSection key={company.stir} />
          </div>
        )}
        {visited.has('hearings') && (
          <div style={{ display: section === 'hearings' ? 'block' : 'none' }}>
            <HearingsSection />
          </div>
        )}
        {visited.has('profile') && (
          <div style={{ display: section === 'profile' ? 'block' : 'none' }}>
            <ProfileSection />
          </div>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  const view = useAppStore((s) => s.view)
  const surface = useAppStore((s) => s.surface)

  // Warm the cheap identity the moment a company is resolved (§5.4)
  useEffect(() => {
    keepIdentityWarm()
  }, [])

  return (
    <AppShell>
      {surface === 'watchlist' ? (
        <WatchlistView />
      ) : surface === 'settings' ? (
        <SettingsView />
      ) : view === 'company' ? (
        <CompanyWorkspace />
      ) : (
        <Launcher />
      )}
      <CommandPalette />
      <ProtoDrawer />
    </AppShell>
  )
}
