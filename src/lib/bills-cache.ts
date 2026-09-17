'use client'

/**
 * Bills cache — session-scoped, in-memory mirror of the last bills stream per
 * STIR. The Bills section writes on every stream tick; the Overview reads it
 * for the prototypeʼs "Toʻlangan boj" / "Muddati oʻtgan" KPIs and the
 * "Soʻnggi toʻlovlar" strip without re-streaming billing.sud.uz.
 * Persisted aggregates (paid/overdue totals) also land in registry meta so
 * the home KPI survives reloads.
 */

import type { EnrichedBill } from '@/lib/api-types'
import { patchMeta } from '@/lib/registry'

const cache = new Map<string, EnrichedBill[]>()
const listeners = new Set<() => void>()
let version = 0

function emit() {
  version++
  listeners.forEach((fn) => fn())
}

export function setCachedBills(stir: string, items: EnrichedBill[]): void {
  if (typeof window === 'undefined') return
  cache.set(stir, items)
  emit()
}

export function getCachedBills(stir: string): EnrichedBill[] | null {
  if (typeof window === 'undefined') return null
  return cache.get(stir) ?? null
}

export function subscribeBills(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function billsCacheVersion(): number {
  return version
}

/** Aggregate used by the Overview KPIs (amounts arrive in tiyins). */
export interface BillsTotals {
  loaded: boolean
  count: number
  paidCount: number
  totalPaid: number
  overdue: number
}

export function billsTotals(stir: string): BillsTotals {
  const items = getCachedBills(stir)
  if (!items) return { loaded: false, count: 0, paidCount: 0, totalPaid: 0, overdue: 0 }
  let paidCount = 0
  let totalPaid = 0
  let overdue = 0
  for (const b of items) {
    const d = b.detail
    const st = d?.invoiceStatus ?? b.invoiceStatus
    if (st === 'PAID' || st === 'USED') paidCount++
    if (st === 'OVERDUE') overdue += d?.overdue ?? d?.balance ?? 0
    totalPaid += d?.paidAmount ?? 0
  }
  return { loaded: true, count: items.length, paidCount, totalPaid, overdue }
}

/** Persist aggregates into the registry meta (feeds the home debt KPI). */
export function patchBillsMeta(stir: string, t: BillsTotals): void {
  patchMeta(stir, {
    billCount: t.count,
    paidCount: t.paidCount,
    paidTotal: t.totalPaid,
    overdueTotal: t.overdue,
    billsLoadedAt: Date.now(),
  })
}
