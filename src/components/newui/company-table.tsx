'use client'

/**
 * New look: companies as ONE sortable table (Bosh sahifa: every listed company; Kuzatuv: the watched ones).
 * The cards it replaces showed two of the facts the registry already holds (rating, next hearing); the table shows
 * all six side by side — status, rating, cases, win rate, next hearing, overdue debt — and a click on a column
 * orders by it (core/company-sort.ts: an unknown value is never treated as zero and always sorts last).
 */

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { calendarDaysUntil } from '@/core/agenda'
import { formatSumCompact } from '@/core/billing-format'
import { avatarHue, nextSort, sortCompanies, type CompanySortKey, type SortDir } from '@/core/company-sort'
import { companyStatusFamily, ratingBandFamily } from '@/core/status'
import { bandOf, familyBadgeClass, familyDotClass, grp, initials } from '@/components/proto/primitives'
import { futureUpcoming, type CompanyRecord } from '@/lib/registry'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

const COLS: { key: CompanySortKey; label: string; cls?: string }[] = [
  { key: 'name', label: 'Kompaniya' },
  { key: 'rating', label: 'Reyting' },
  { key: 'cases', label: 'Ishlar', cls: 'num opt' },
  { key: 'winRate', label: 'Yutuq', cls: 'opt' },
  { key: 'hearing', label: 'Keyingi majlis' },
  { key: 'debt', label: 'Qarz, soʻm', cls: 'num' },
]

function statusTitle(status?: string): string {
  return status && status.trim() ? status : 'Holati hali oʻqilmagan'
}

export function CompanyTable({
  records,
  onOpen,
  onRefresh,
  onRemove,
  removeTitle,
  canRemove,
  empty,
}: {
  records: CompanyRecord[]
  onOpen: (rec: CompanyRecord) => void
  onRefresh: (stir: string) => Promise<void>
  onRemove: (rec: CompanyRecord) => void
  removeTitle: string
  /** rows that may be removed here (default: all) */
  canRemove?: (rec: CompanyRecord) => boolean
  empty: React.ReactNode
}) {
  const [sort, setSort] = useState<{ key: CompanySortKey; dir: SortDir }>({ key: 'hearing', dir: 'asc' })
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const rows = useMemo(() => {
    const derived = records.map((rec) => {
      const m = rec.meta
      return {
        rec,
        stir: rec.stir,
        name: rec.name,
        score: m?.score,
        cases: m?.cases,
        winRate: m?.winRate,
        hearingIso: futureUpcoming(m)[0]?.iso ?? null,
        // bills never opened = unknown, not «no debt»
        debt: m?.billsLoadedAt ? m.overdueTotal ?? 0 : null,
      }
    })
    return sortCompanies(derived, sort.key, sort.dir)
  }, [records, sort])

  const refresh = (stir: string) => {
    if (busy.has(stir)) return
    setBusy((b) => new Set(b).add(stir))
    void onRefresh(stir)
      .catch(() => toast.error('Yangilashda xatolik — manbalar javob bermadi'))
      .finally(() => setBusy((b) => { const n = new Set(b); n.delete(stir); return n }))
  }

  if (records.length === 0) return <>{empty}</>

  return (
    <div className="ct-wrap">
      <table className="ct">
        <thead>
          <tr>
            {COLS.map((c) => {
              const on = sort.key === c.key
              return (
                <th key={c.key} className={c.cls} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className={on ? 'on' : ''} onClick={() => setSort((s) => nextSort(s, c.key))}>
                    {c.label}
                    {on ? sort.dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden /> : null}
                  </button>
                </th>
              )
            })}
            <th className="act" aria-label="Amallar" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rec, score, cases, winRate, hearingIso, debt }) => {
            const m = rec.meta
            const days = hearingIso ? calendarDaysUntil(hearingIso) : null
            const [, mo, d] = hearingIso ? hearingIso.split('-').map(Number) : [0, 0, 0]
            const removable = canRemove ? canRemove(rec) : true
            return (
              <tr
                key={rec.stir}
                tabIndex={0}
                onClick={() => onOpen(rec)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onOpen(rec)
                  }
                }}
              >
                <td className="ct-name">
                  <div className="ct-co">
                    {/* the monogram carries the company's identity (a stable colour per STIR); the status dot sits on its corner */}
                    <span className={`ct-av av-${avatarHue(rec.stir)}`} aria-hidden>
                      {initials(rec.name || '')}
                      <i className={`p-dot ${familyDotClass(companyStatusFamily(m?.status))}`} title={statusTitle(m?.status)} />
                    </span>
                    <span className="ct-id">
                      <b title={rec.name}>{rec.name || `STIR ${grp(rec.stir)}`}</b>
                      <span>{grp(rec.stir)}</span>
                    </span>
                  </div>
                </td>
                <td>
                  {score != null || m?.rating ? (
                    <span className="ct-rate">
                      <b>{score != null ? score : '—'}</b>
                      {m?.rating ? <span className={`lt ${familyBadgeClass(ratingBandFamily(m.rating) ?? 'neutral')}`}>{m.rating}</span> : null}
                    </span>
                  ) : (
                    <span className="ct-none">—</span>
                  )}
                </td>
                <td className="num opt">{cases != null ? cases : <span className="ct-none">—</span>}</td>
                <td className="opt">
                  {winRate != null ? (
                    <span className="ct-win">
                      <b>{Math.round(winRate)}%</b>
                      <span className="ct-bar"><i className={`d-${bandOf(winRate)}`} style={{ width: `${Math.max(0, Math.min(100, winRate))}%` }} /></span>
                    </span>
                  ) : (
                    <span className="ct-none">—</span>
                  )}
                </td>
                <td>
                  {hearingIso && days !== null ? (
                    <span className="ct-hear">
                      <b>{String(d).padStart(2, '0')} {MONTHS[mo - 1] ?? ''}</b>
                      <span className={days <= 7 ? 'soon' : ''}>{days === 0 ? 'bugun' : days === 1 ? 'ertaga' : `${days} kun`}</span>
                    </span>
                  ) : (
                    <span className="ct-none">—</span>
                  )}
                </td>
                <td className="num">
                  {debt === null ? (
                    <span className="ct-none" title="Toʻlovlar hali ochilmagan">—</span>
                  ) : debt > 0 ? (
                    <b className="ct-debt">{formatSumCompact(debt)}</b>
                  ) : (
                    <span className="ct-none" title="Muddati oʻtgan qarz yoʻq">0</span>
                  )}
                </td>
                <td className="act">
                  <button type="button" className="ct-act" title="Yangilash" aria-label="Yangilash" onClick={(e) => { e.stopPropagation(); refresh(rec.stir) }}>
                    {busy.has(rec.stir) ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <RefreshCw />}
                  </button>
                  {removable && (
                    <button type="button" className="ct-act danger" title={removeTitle} aria-label={removeTitle} onClick={(e) => { e.stopPropagation(); onRemove(rec) }}>
                      <X />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
