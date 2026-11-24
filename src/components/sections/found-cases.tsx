'use client'

/**
 * The cases found BY NUMBER from the company's bills (lib/bill-cases): the cases its TIN lists do not show. A big company has tens of thousands
 * of them, so this list is read from the server a PAGE at a time (court-type chips with their counts, search, paging) and grows while the
 * background job runs, without anything else on the screen reloading. A row opens the same case drawer as the main list.
 */

import { useEffect, useState } from 'react'
import { ChevronRight, Gavel, Search } from 'lucide-react'
import { Seg } from '@/components/proto/primitives'
import { ListPagination, DEFAULT_PAGE_SIZE } from '@/components/ui-custom/list-pagination'
import { useFoundCases } from '@/hooks/use-found-cases'
import { caseStatusInfo } from '@/core/case-status'
import { formatClaimAmount } from '@/core/billing-format'

const COURT_LABEL: Record<string, string> = { economic: 'Iqtisodiy', civil: 'Fuqarolik', administrative: 'Maʼmuriy', criminal: 'Jinoyat' }
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function FoundCases({ stir }: { stir: string }) {
  const [court, setCourt] = useState('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE)

  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250)
    return () => clearTimeout(t)
  }, [text])
  useEffect(() => setPage(1), [court, q, stir])

  const { data } = useFoundCases(stir, { court: court || undefined, q, page, size })
  const counts = data?.byCourt ?? {}
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
  if (!data || (total === 0 && !q)) return null

  const chips = [{ key: 'all', label: `Barchasi · ${fmt(total)}` }, ...Object.entries(counts).filter(([, n]) => n).map(([k, n]) => ({ key: k, label: `${COURT_LABEL[k] ?? k} · ${fmt(n ?? 0)}` }))]
  const open = (caseNumber: string, courtType: string) => window.dispatchEvent(new CustomEvent('sud:open-case', { detail: { caseNumber, courtType } }))

  return (
    <div className="p-card" style={{ marginTop: 16 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <b style={{ fontSize: 14 }}>Toʻlovlar orqali topilgan ishlar</b>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-3)', marginTop: 3 }}>
          Sud roʻyxati koʻrsatmagan, kvitansiyalarda nomi bor ishlar: raqam boʻyicha olingan va serverda saqlangan.
        </div>
      </div>
      {/* the filter row sits INSIDE the card: the same 18 px side padding as the heading above it and room between the two (it was flush with the card's edge and touching the text) */}
      <div className="filterbar" style={{ padding: '14px 18px', marginBottom: 0 }}>
        <div className="f-search">
          <Search />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ish raqami, sud yoki tomon…" />
        </div>
        {chips.length > 2 && <Seg options={chips} value={court || 'all'} onChange={(k) => setCourt(k === 'all' ? '' : k)} />}
      </div>
      {data.matched === 0 ? (
        <div style={{ padding: '18px', color: 'var(--text-3)', fontSize: 13 }}>Hech narsa topilmadi.</div>
      ) : (
        <div className="list">
          {data.rows.map(({ courtType, row }) => {
            const st = caseStatusInfo(row.caseStatus)
            return (
              <div className="lrow" key={`${courtType}-${row.caseNumber}`} data-case={row.caseNumber} onClick={() => open(row.caseNumber, courtType)}>
                <div className="lead">
                  <Gavel />
                </div>
                <div className="main-c">
                  <b className="mono">{row.caseNumber}</b>
                  <div className="sub">
                    {[COURT_LABEL[courtType], row.courtName, row.caseType].filter(Boolean).join(' · ')}
                    {row.defendant ? ` · ${row.defendant}` : ''}
                  </div>
                </div>
                <span className="badge b-neu">{st?.label ?? (row.caseStatus || '-')}</span>
                <div className="amt">
                  {formatClaimAmount(row.claimAmount) !== '-' ? formatClaimAmount(row.claimAmount) : ''}
                  <small>{row.dateFiled || ''}</small>
                </div>
                <span className="chev">
                  <ChevronRight />
                </span>
              </div>
            )
          })}
        </div>
      )}
      <ListPagination page={page} pageSize={size} total={data.matched} hideWhenSinglePage onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1) }} />
    </div>
  )
}
