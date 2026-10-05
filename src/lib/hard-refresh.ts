'use client'

/**
 * Hard refresh of ONE company: scrape everything fresh now instead of reading the daily snapshots.
 *
 * Order matters: the forced stats scrape (which also refills the server's court-list and orginfo memory, and drops the
 * company's older snapshots there) runs first, then the live hearings read sees those fresh lists. When it is done the
 * active section re-reads (`sud:company-refreshed`) without forcing a second scrape.
 */

import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { clearCached } from './cache'
import { clearAge } from './data-age'
import { enrichCompanyDetailed, type EnrichResult } from './enrich'

const busy = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export const COMPANY_REFRESHED = 'sud:company-refreshed'

export function useRefreshing(stir: string | undefined): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => !!stir && busy.has(stir),
    () => false,
  )
}

/** What each part did. A second press while one runs is ignored (null). */
export async function hardRefreshCompany(stir: string): Promise<EnrichResult | null> {
  if (!stir || busy.has(stir)) return null
  busy.add(stir)
  emit()
  try {
    clearAge(stir)
    clearCached(`upcoming:${stir}`)
    const result = await enrichCompanyDetailed(stir, true)
    window.dispatchEvent(new CustomEvent(COMPANY_REFRESHED, { detail: { stir } }))
    return result
  } finally {
    busy.delete(stir)
    emit()
  }
}

/** The button and the R key: refresh with a toast that says how it went. */
export async function hardRefreshWithToast(stir: string): Promise<void> {
  if (!stir || busy.has(stir)) return
  const id = toast.loading('Toʻliq yangilanmoqda…')
  const r = await hardRefreshCompany(stir)
  if (!r) return
  if (r.stats && r.hearings) toast.success('Yangilandi', { id })
  else if (r.stats) toast.warning('Yangilandi, lekin majlislarni olib boʻlmadi', { id })
  else toast.error('Yangilab boʻlmadi: saytlar toʻliq javob bermadi, eski maʼlumot qoldi', { id })
}
