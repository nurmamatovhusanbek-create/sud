'use client'

/**
 * The app store (zustand) — the no-routing interim the guides allow
 * (redesign §5.5, arch guide §3.5): a single `/` route hosting the
 * launcher ↔ workspace split with in-app section state.
 *
 * REQUIRED by the guides and implemented here:
 *   - one shared company context (activeCompany) hydrated on resolve
 *   - launcher / workspace split
 *   - view state addressable (history integration where the sandbox allows)
 */

import { create } from 'zustand'
import type { Company } from '@/lib/domain/company'
import { normalizeStir } from '@/lib/domain/company'
import { upsertRegistry } from '@/lib/registry'

export type AppView = 'launcher' | 'company'
export type SectionKey = 'overview' | 'bills' | 'cases' | 'hearings' | 'profile'
/** v18: Statistika last (prototype nav order); keys are load-bearing — never rename. */
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'bills', label: 'Toʻlovlar' },
  { key: 'cases', label: 'Sud ishlari' },
  { key: 'hearings', label: 'Majlislar' },
  { key: 'profile', label: 'Kompaniya' },
  { key: 'overview', label: 'Statistika' },
]
/** v18: the sidebar workspace group — SECTIONS with Kuzatuv slotted before Statistika. */
export const WORKSPACE_NAV: { key: SectionKey | 'kuzatuv'; label: string }[] = [
  { key: 'bills', label: 'Toʻlovlar' },
  { key: 'cases', label: 'Sud ishlari' },
  { key: 'hearings', label: 'Majlislar' },
  { key: 'profile', label: 'Kompaniya' },
  { key: 'kuzatuv', label: 'Kuzatuv' },
  { key: 'overview', label: 'Statistika' },
]
export type CaseCourtFilter = 'all' | 'economic' | 'civil' | 'administrative'

export type GlobalSurface = 'main' | 'watchlist' | 'settings'
export type CommandPurpose = 'search' | 'add'

interface AppState {
  view: AppView
  section: SectionKey
  surface: GlobalSurface
  activeCompany: Company | null
  commandOpen: boolean
  /** v18: one-shot court filter for Sud ishlari (mini cards + pizza «Ishlarni koʻrish»). */
  caseCourtFilter: CaseCourtFilter
  /** 'add' mode: choosing a company in the palette adds it to the watchlist. */
  commandPurpose: CommandPurpose

  /** Resolve a company by STIR and enter its workspace. */
  openCompany: (stir: string, seed?: Partial<Company>) => boolean
  /** Patch the active company (e.g. name/status/rating once identity loads). */
  patchCompany: (patch: Partial<Company>) => void
  setSection: (s: SectionKey) => void
  setCaseCourtFilter: (f: CaseCourtFilter) => void
  goLauncher: () => void
  setSurface: (s: GlobalSurface) => void
  setCommandOpen: (open: boolean) => void
  setCommandPurpose: (p: CommandPurpose) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'launcher',
  section: 'overview',
  surface: 'main',
  activeCompany: null,
  commandOpen: false,
  commandPurpose: 'search',
  caseCourtFilter: 'all',

  openCompany: (stir, seed) => {
    const normalized = normalizeStir(stir)
    if (!normalized) return false
    const existing = get().activeCompany
    const sameCompany = existing?.stir === normalized
    set({
      view: 'company',
      surface: 'main',
      activeCompany: {
        stir: normalized,
        name: seed?.name ?? (sameCompany ? existing?.name : undefined),
        status: seed?.status ?? (sameCompany ? existing?.status : undefined),
        rating: seed?.rating ?? (sameCompany ? existing?.rating : undefined),
        updatedAt: Date.now(),
      },
      // Reset section only when the company actually changes.
      ...(sameCompany ? {} : { section: 'overview' }),
    })
    upsertRegistry(normalized, seed?.name)
    return true
  },

  patchCompany: (patch) =>
    set((s) =>
      s.activeCompany
        ? { activeCompany: { ...s.activeCompany, ...patch, updatedAt: Date.now() } }
        : s,
    ),

  setSection: (section) => set({ section }),
  setCaseCourtFilter: (caseCourtFilter) => set({ caseCourtFilter }),
  goLauncher: () => set({ view: 'launcher', surface: 'main' }),
  setSurface: (surface) => set({ surface }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setCommandPurpose: (commandPurpose) => set({ commandPurpose }),
}))

/** Selector: is a company active (workspace visible). */
export const useActiveCompany = () => useAppStore((s) => s.activeCompany)
