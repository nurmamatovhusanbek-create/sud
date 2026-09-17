/**
 * CaseRefRow — v147 §3 shared primitive.
 *
 * One row pattern for "hereʼs a related case — hereʼs its status — go view it."
 * Used in ReceiptView (bills), CourtCaseCard cross-references,
 * UpcomingHearingCard, and WatchlistTab.
 *
 * Design:
 *  - Entire row is clickable (not just a small chip inside)
 *  - Status is a dot + text (not a bordered chip) — reads as metadata, not a button
 *  - View affordance is a trailing chevron, unstyled except on hover
 *  - Case number is the visual anchor (mono, left-aligned)
 */
import { ChevronRight } from 'lucide-react'

interface CaseRefRowProps {
  caseNumber: string
  status?: 'used' | 'returned' | 'pending' | 'active' | string
  statusLabel?: string
  amount?: string | null
  amountLabel?: string
  isPrimary?: boolean
  onClick?: () => void
}

const STATUS_DOT_COLOR: Record<string, string> = {
  used: 'var(--accent)',
  returned: 'var(--text-3)',
  pending: 'var(--text-3)',
  active: 'var(--accent)',
}

export function CaseRefRow({
  caseNumber,
  status,
  statusLabel,
  amount,
  amountLabel = "soʻm",
  isPrimary = false,
  onClick,
}: CaseRefRowProps) {
  const dotColor = status ? (STATUS_DOT_COLOR[status] || 'var(--text-3)') : 'var(--text-3)'

  return (
    <div
      className="case-ref-row"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className="case-ref-main">
        {status && (
          <span className="case-ref-status">
            <span className="case-ref-dot" style={{ background: dotColor }} />
            <span className="case-ref-status-text">{statusLabel || status}</span>
          </span>
        )}
        <span className="case-ref-number mono">{caseNumber}</span>
        {isPrimary && <span className="case-ref-primary-tag">Asosiy</span>}
      </div>
      <div className="case-ref-side">
        {amount && (
          <span className="case-ref-amount mono">
            {amount}
            <span className="case-ref-amount-unit"> {amountLabel}</span>
          </span>
        )}
        {onClick && <ChevronRight className="case-ref-chevron" />}
      </div>
    </div>
  )
}
