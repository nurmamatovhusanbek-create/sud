'use client'

/**
 * Bell alerts, shared by every look's shell: watched companies' hearings inside
 * the 7-day window, each led by the COUNTERPARTY (matched from the cached
 * CompanyStats by case number) and a numeric DD.MM date.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { daysUntilIso, upcomingOf, watched } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { getCached } from '@/lib/cache'
import type { CompanyStats } from '@/lib/api-types'

export interface Notif {
  stir: string
  name?: string
  isoDate: string
  court?: string
  caseNumber?: string
  time?: string
  judge?: string
}

/** Watched companies' hearings within the 7-day alert window — EVERY hearing, not one per company. */
export function computeAlerts(): Notif[] {
  const out: Notif[] = []
  const now = Date.now()
  for (const w of watched()) {
    for (const h of upcomingOf(w.meta)) {
      const days = daysUntilIso(h.iso, now)
      if (days === null || days < 0 || days > 7) continue
      out.push({ stir: w.stir, name: w.name, isoDate: h.iso, court: h.court, caseNumber: h.caseNumber, time: h.time, judge: h.judge })
    }
  }
  return out.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || (a.time || '').localeCompare(b.time || ''))
}

const noopSubscribe = () => () => {}
/** Hydration probe — false on the server + first client render, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

/**
 * The alert title is the OTHER party of the case. We match the case number
 * inside the company's cached stats (10-min server memoization makes this
 * free); without a match we fall back to the watched company name.
 */
export function counterpartyFor(stir: string, caseNumber?: string, fallback?: string): string {
  if (caseNumber) {
    const stats = getCached<CompanyStats>(`stats:${stir}`)
    const hit = stats?.cases?.find((c) => c.caseNumber === caseNumber)
    if (hit?.counterparty) return hit.counterparty
  }
  return fallback || `STIR ${stir}`
}

/** `04.12` from an ISO date. */
export function ddmm(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

/** The current alert list (empty until hydrated: it reads the localStorage registry). */
export function useAlerts(): Notif[] {
  const rv = useRegistryVersion()
  const hydrated = useHydrated()
  return useMemo(() => (hydrated ? computeAlerts() : []), [rv, hydrated])
}
