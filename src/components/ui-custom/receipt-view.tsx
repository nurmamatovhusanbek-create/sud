/**
 * ReceiptView — stylized cheque/receipt rendering for bill usage history.
 *
 * v147 §1.1: Fixed duplicate case bug — claim case number and history items
 * are now merged into ONE list. If the claim case already appears in history,
 * itʼs marked as "Asosiy" (primary) instead of being duplicated.
 *
 * v147 §3: Uses CaseRefRow for each case reference — one shared row pattern
 * with dot+text status (not a bordered chip) and trailing chevron.
 */
import { Receipt } from 'lucide-react'
import { CaseRefRow } from './case-ref-row'

interface ReceiptUsageItem {
  caseNumber: string | null
  caseId: number | null
  amount: number | null
  rolledBackAt: number | null
  courtType?: string
  invoiceStatus?: string | null
}

interface ReceiptViewProps {
  billNumber: string
  issued: number | null | undefined
  court: string | null | undefined
  purpose: string | null | undefined
  amount: number | null | undefined
  claimCaseNumber: string | null | undefined
  history: ReceiptUsageItem[]
  onViewCase: (caseNumber: string, courtType?: string) => void
  formatSum: (n: number | null | undefined) => string
  formatDate: (ts: number | null | undefined) => string
}

export function ReceiptView({
  billNumber,
  issued,
  court,
  purpose,
  amount,
  claimCaseNumber,
  history,
  onViewCase,
  formatSum,
  formatDate,
}: ReceiptViewProps) {
  // v147 §1.1: Merge claimCaseNumber into history to avoid duplicates.
  // If claimCaseNumber already exists in history, mark that row as primary.
  // If it doesnʼt exist, prepend it as a new primary row.
  const claimInHistory = claimCaseNumber
    ? history.some(h => h.caseNumber === claimCaseNumber)
    : false

  const mergedHistory = [...history]
  if (claimCaseNumber && !claimInHistory) {
    mergedHistory.unshift({
      caseNumber: claimCaseNumber,
      caseId: null,
      amount: null,
      rolledBackAt: null,
      courtType: undefined,
      invoiceStatus: null,
    })
  }

  return (
    <div className="receipt-view">
      {/* Serrated top edge */}
      <div className="receipt-edge receipt-edge-top" />

      <div className="receipt-body">
        {/* Header */}
        <div className="receipt-header">
          <Receipt className="receipt-header-icon" />
          <div className="receipt-header-text">
            <div className="receipt-title">KVITANSIYA</div>
            <div className="receipt-sub">Sud toʻlov hujjati</div>
          </div>
        </div>

        {/* Barcode-style bill number */}
        <div className="receipt-barcode">
          <div className="receipt-barcode-bars">
            {billNumber.split('').map((digit, i) => (
              <div
                key={i}
                className="receipt-bar"
                style={{ height: `${8 + (parseInt(digit) || 0) * 3}px` }}
              />
            ))}
          </div>
          <div className="receipt-barcode-number">{billNumber}</div>
        </div>

        {/* Meta rows */}
        <div className="receipt-meta">
          {issued && (
            <div className="receipt-meta-row">
              <span className="receipt-meta-label">Sana</span>
              <span className="receipt-meta-value mono">{formatDate(issued)}</span>
            </div>
          )}
          {court && (
            <div className="receipt-meta-row">
              <span className="receipt-meta-label">Sud</span>
              <span className="receipt-meta-value">{court}</span>
            </div>
          )}
          {purpose && (
            <div className="receipt-meta-row">
              <span className="receipt-meta-label">Maqsad</span>
              <span className="receipt-meta-value receipt-meta-value-wrap">{purpose}</span>
            </div>
          )}
          <div className="receipt-meta-row receipt-amount-row">
            <span className="receipt-meta-label">Summa</span>
            <span className="receipt-amount mono">{formatSum(amount)}</span>
            <span className="receipt-amount-unit">soʻm</span>
          </div>
        </div>

        {/* v147 §1.1 + §3: Merged case list using CaseRefRow.
            No more separate claim block + history list.
            One row per case, at most one view action per case. */}
        {mergedHistory.length > 0 && (
          <div className="receipt-items">
            <div className="receipt-items-header">
              Ishlatilgan ishlar ({mergedHistory.length})
            </div>
            <div className="receipt-divider" />
            {mergedHistory.map((h, i) => {
              const isPrimary = claimCaseNumber === h.caseNumber
              const status = h.rolledBackAt ? 'returned' : 'used'
              const statusLabel = h.rolledBackAt ? 'Qaytarilgan' : 'Ishlatilgan'
              return (
                <CaseRefRow
                  key={i}
                  caseNumber={h.caseNumber || (h.caseId ? `#${h.caseId}` : '-')}
                  status={status}
                  statusLabel={statusLabel}
                  amount={h.amount != null ? formatSum(h.amount) : null}
                  isPrimary={isPrimary}
                  onClick={h.caseNumber ? () => onViewCase(h.caseNumber!, h.courtType) : undefined}
                />
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="receipt-footer">
          Sud Billing Lookup tomonidan yaratilgan
        </div>
      </div>

      {/* Serrated bottom edge */}
      <div className="receipt-edge receipt-edge-bottom" />
    </div>
  )
}
