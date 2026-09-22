'use client'

/**
 * Sud tizimi — app root.
 *
 * Views mirror the v18 prototypeʼs surfaces: home (launcher), company
 * workspace (context bar + sidebar-driven sections), watchlist, settings —
 * hosted on the single `/` route with in-app state. The prototype drawer
 * (receipt / case / compare) mounts globally.
 *
 * Keyboard model (§7.4): ⌘K/⌘F palette · / palette · 1–6 workspace nav ·
 * R refresh · E export · Esc close.
 */

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { CommandPalette } from '@/components/shell/command-palette'
import { ProtoDrawer } from '@/components/proto/drawer'
import { Launcher } from '@/components/views/launcher'
import { WatchlistView } from '@/components/views/watchlist'
import { SettingsView } from '@/components/views/settings-view'
import { DocumentsView } from '@/components/views/documents-view'
import { ContextBar } from '@/components/company/context-bar'
import { OverviewSection } from '@/components/sections/overview'
import { BillsSection } from '@/components/sections/bills'
import { CasesSection } from '@/components/sections/cases'
import { HearingsSection } from '@/components/sections/hearings'
import { ProfileSection } from '@/components/sections/profile'
import { useAppStore, WORKSPACE_NAV, type SectionKey } from '@/lib/store/app-store'
import { exportStatsXlsx, getStats } from '@/lib/api-client'
import { toast } from 'sonner'
import { keepIdentityWarm } from '@/lib/identity'

/** Workspace: the v18 sidebar IS the nav — this mounts the active section. */
function CompanyWorkspace() {
  const company = useAppStore((s) => s.activeCompany)
  const section = useAppStore((s) => s.section)
  const setSection = useAppStore((s) => s.setSection)
  // Adjust-state-during-render pattern (React docs): no effect needed.
  const [prevSection, setPrevSection] = useState<SectionKey>(section)
  // Seed with the CURRENT section, not a hard-coded 'overview' — otherwise a
  // company that opens directly on another section (e.g. profile) never gets
  // it added to `visited` (prevSection already equals section on mount) and
  // that section renders blank until you navigate away and back.
  const [visited, setVisited] = useState<Set<SectionKey>>(() => new Set([section]))
  if (prevSection !== section) {
    setPrevSection(section)
    setVisited((v) => new Set(v).add(section))
  }

  // Keyboard model: 1–6 follow the sidebar workspace group (Kuzatuv = 5,
  // Statistika = 6), R refresh, E export
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const idx = Number(e.key)
      if (idx >= 1 && idx <= WORKSPACE_NAV.length) {
        const key = WORKSPACE_NAV[idx - 1].key
        if (key === 'kuzatuv') useAppStore.getState().setSurface('watchlist')
        else {
          useAppStore.getState().setSurface('main')
          setSection(key)
        }
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

  return (
    <div>
      <ContextBar />

      {/* Section content — lazy mount on first visit, then keep alive.
          v18: the sidebar nav replaces the old tab rail. */}
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
      ) : surface === 'documents' ? (
        <DocumentsView />
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
