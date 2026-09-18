'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from '@/components/ui/pagination'

/**
 * v204 (P-D): List pager for the data sections (bills / cases / hearings).
 * Uzbek labels, page window with ellipsis, prev/next. Backed by the shadcn
 * pagination primitives (ui/pagination.tsx), styled by the token system.
 */

export const DEFAULT_PAGE_SIZE = 25
export const PAGE_SIZES = [10, 25, 50, 100] as const

/** Clamp a requested page into [1 .. maxPage] for the current filter result. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  return Math.min(Math.max(1, page), maxPage)
}

function pageWindow(page: number, total: number, pageSize: number): (number | '…')[] {
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  if (maxPage <= 7) return Array.from({ length: maxPage }, (_, i) => i + 1)
  const win: (number | '…')[] = [1]
  const lo = Math.max(2, page - 1)
  const hi = Math.min(maxPage - 1, page + 1)
  if (lo > 2) win.push('…')
  for (let p = lo; p <= hi; p++) win.push(p)
  if (hi < maxPage - 1) win.push('…')
  win.push(maxPage)
  return win
}

export interface ListPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Right-side hint, e.g. "25–48 / 66". */
  rangeLabel?: string
}

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  rangeLabel,
}: ListPaginationProps) {
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
      <Pagination className="items-start justify-start w-auto mx-0">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault()
                if (page > 1) onPageChange(page - 1)
              }}
              aria-disabled={page <= 1}
              className={page <= 1 ? 'pointer-events-none opacity-40' : undefined}
            />
          </PaginationItem>
          {pageWindow(page, total, pageSize).map((p, i) =>
            p === '…' ? (
              <PaginationItem key={`e-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    onPageChange(p)
                  }}
                  className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm transition-colors ${
                    p === page
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'hover:bg-muted'
                  }`}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </a>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e) => {
                e.preventDefault()
                if (page < maxPage) onPageChange(page + 1)
              }}
              aria-disabled={page >= maxPage}
              className={page >= maxPage ? 'pointer-events-none opacity-40' : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {from}–{to} / {total}
          {rangeLabel ? ` · ${rangeLabel}` : ''}
        </span>
        <span className="opacity-40">·</span>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          className="disabled:opacity-40 hover:text-foreground transition-colors"
        >
          <ChevronLeft className="inline h-3 w-3" /> Boshiga
        </button>
        <button
          type="button"
          disabled={page >= maxPage}
          onClick={() => onPageChange(maxPage)}
          className="disabled:opacity-40 hover:text-foreground transition-colors"
        >
          Oxiriga <ChevronRight className="inline h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/** Per-page <select> shown next to the section filter bar. */
export function PageSizeSelect({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent border rounded-md px-1.5 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n} / sahifa
          </option>
        ))}
      </select>
    </label>
  )
}
