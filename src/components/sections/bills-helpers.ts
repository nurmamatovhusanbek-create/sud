'use client'

/**
 * Bills helpers — bridges the shipped status maps to the status-family
 * vocabulary. Status label resolution uses the libʼs INVOICE_STATUSES.
 */
import { billStatusFamily } from '@/core/status'
import type { StatusFamily } from '@/core/status'

/** Overdue amount is not part of the shipped data model; default 0. */
export function billStatusFamilySafe(status: string | null | undefined): StatusFamily {
  return billStatusFamily(status, 0)
}
