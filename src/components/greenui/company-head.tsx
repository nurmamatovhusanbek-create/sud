'use client'

/**
 * The open company's header in the green look: one soft card — a ringed monogram, the name large, a row of chips
 * (status, rating, STIR with copy, how fresh the data is) and the actions as pills on the right. State and handlers
 * come from company/context-bar, which stays the one place that talks to the store and the scrapers.
 */

import { Copy, Download, FileText, RefreshCw, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface GreenCompanyHeadProps {
  mono: string
  name: string
  stir: string
  status?: { label: string; dot: string }
  rating?: { label: string; badge: string }
  copied: boolean
  onCopy: () => void
  age?: { label: string; stale: boolean; title: string }
  refreshing: boolean
  onRefresh: () => void
  onExport: () => void
  onReport: () => void
  watching: boolean
  onWatch: () => void
}

export function GreenCompanyHead(p: GreenCompanyHeadProps) {
  return (
    <header className="gx-ch">
      <span className="gx-ch-mono" aria-hidden>{p.mono}</span>
      <div className="gx-ch-id">
        <h1>{p.name}</h1>
        <div className="gx-chips">
          {p.status && (
            <span className="gx-chip"><i className={`p-dot ${p.status.dot}`} />{p.status.label}</span>
          )}
          {p.rating && <span className={`badge ${p.rating.badge}`}>Reyting {p.rating.label}</span>}
          <button className="gx-chip mono" data-copy onClick={p.onCopy} aria-label="STIRni nusxalash" title="STIRni nusxalash">
            STIR {p.stir}
            <Copy style={{ opacity: p.copied ? 1 : undefined }} />
          </button>
          {p.age && <span className={cn('gx-chip soft', p.age.stale && 'stale')} data-stale={p.age.stale || undefined} title={p.age.title}>{p.age.label}</span>}
        </div>
      </div>
      <div className="gx-ch-acts">
        <button className="gx-round" data-act="refresh" onClick={p.onRefresh} disabled={p.refreshing} aria-busy={p.refreshing} aria-label="Toʻliq yangilash (R)" title="Toʻliq yangilash (R): saytlardan yangidan oladi">
          <RefreshCw className={p.refreshing ? 'spin' : undefined} />
        </button>
        <button className="gx-round" data-act="export" onClick={p.onExport} aria-label="Eksport (E)" title="Eksport (E)">
          <Download />
        </button>
        <button className="btn btn-outline btn-sm" data-act="report" onClick={p.onReport} title="Kompaniya hisoboti (PDF)">
          <FileText />
          <span>Hisobot</span>
        </button>
        <button className={`btn ${p.watching ? 'btn-primary' : 'btn-outline'} btn-sm`} data-act="watch" onClick={p.onWatch}>
          <Star />
          <span>{p.watching ? 'Kuzatuvda' : 'Kuzatish'}</span>
        </button>
      </div>
    </header>
  )
}
