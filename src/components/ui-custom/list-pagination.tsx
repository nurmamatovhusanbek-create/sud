'use client'

/**
 * ListPagination (v204, P-D) — shared pager + per-page selector for the long
 * list sections (bills, cases, hearings). Restores the previous app's
 * pagination behavior the rebuild had dropped: a page window over the sliced
 * list plus a per-page <select> (10/25/50/100), with Monochrome-Signal
 * styling on top of the shadcn Pagination primitives.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
} from '@/components/ui/pagination'

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 25

/** Page numbers with ellipsis windows, e.g. [1, '…', 4, 5, 6, '…', 20]. */
function pageWindow(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const lo = Math.max(2, page - 1)
  const hi = Math.min(totalPages - 1, page + 1)
  if (lo > 2) out.push('…')
  for (let p = lo; p <= hi; p++) out.push(p)
  if (hi < totalPages - 1) out.push('…')
  out.push(totalPages)
  return out
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(1, page), totalPages)
}

interface ListPaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  /** Hide the whole control when the list is short. */
  hideWhenSinglePage?: boolean
}

export function ListPagination({ page, pageSize, total, onPage, onPageSize, hideWhenSinglePage = true }: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (hideWhenSinglePage && totalPages <= 1) return null

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  const go = (p: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    onPage(clampPage(p, total, pageSize))
  }

  return (
    <div
      className="filterbar"
      style={{ marginBottom: 0, marginTop: 14, alignItems: 'center', gap: 12 }}
    >
      <span className="faint" style={{ fontSize: 12 }}>
        {from}–{to} / {total}
      </span>
      <label className="faint" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        Sahifa
        <select
          className="mono"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) || DEFAULT_PAGE_SIZE)}
          style={{
            background: 'var(--surface-active)',
            color: 'var(--text-1)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '3px 6px',
            fontSize: 12,
          }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div style={{ flex: 1 }} />
      <Pagination style={{ margin: 0, width: 'auto' }}>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink
              href="#"
              aria-label="Oldingi sahifa"
              size="icon"
              className={page <= 1 ? 'pointer-events-none opacity-40' : undefined}
              onClick={go(page - 1)}
            >
              <ChevronLeft />
            </PaginationLink>
          </PaginationItem>
          {pageWindow(page, totalPages).map((p, i) =>
            p === '…' ? (
              <PaginationItem key={`e-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink href="#" isActive={p === page} onClick={go(p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationLink
              href="#"
              aria-label="Keyingi sahifa"
              size="icon"
              className={page >= totalPages ? 'pointer-events-none opacity-40' : undefined}
              onClick={go(page + 1)}
            >
              <ChevronRight />
            </PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
