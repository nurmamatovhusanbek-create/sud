import { NextRequest, NextResponse } from 'next/server'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/bills/export
 * Body: { bills: [...] }
 *
 * Generates an .xlsx file from the provided bill data (client-side POST).
 * Columns: Kvitansiya | Kompaniya | Summa | Toʻlangan | Toʻlanmagan |
 *          Holat | Sud | Berilgan sana | Amal qilish | Ish raqami | Turi
 *
 * v204 (P-C): the hand-rolled JSZip XML assembly was extracted into
 * lib/xlsx.ts (buildXlsx) — shared with stats/court-cases/hearings exports.
 * No behavior change.
 */

const HEADERS = ['Kvitansiya', 'Kompaniya', 'Summa', "Toʻlangan", "Toʻlanmagan", 'Holati', 'Sud', 'Berilgan sana', 'Amal qilish', 'Ish raqami', 'Turi']
const COL_WIDTHS = [22, 35, 15, 15, 15, 12, 40, 14, 14, 22, 18]

async function POST_impl(req: NextRequest) {
  try {
    const body = await req.json()
    const bills = body.bills as any[]

    if (!bills || !Array.isArray(bills) || bills.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Eksport uchun to\'lovlar yo\'q' },
        { status: 400 },
      )
    }

    const rows = bills.map((b: any) => {
      const d = b.detail || {}
      const status = d.invoiceStatus || b.invoiceStatus || '-'
      const amount = d.amount || '-'
      const paid = d.paidAmount || (status === 'PAID' ? amount : '0')
      const unpaid = d.balance || (status === 'PAID' ? '0' : amount)
      const court = d.courtName || '-'
      const issued = b.issued || '-'
      const expiry = d.expiry || '-'
      const caseNum = d.claimCaseNumber || '-'
      const category = d.payCategory || d.description || '-'

      return [
        b.number || '-',
        b.companyName || '-',
        String(amount),
        String(paid),
        String(unpaid),
        status === 'PAID' ? "Toʻlangan" : status === 'PARTIAL' ? "Qisman" : status === 'UNPAID' ? "Toʻlanmagan" : String(status),
        String(court),
        String(issued),
        String(expiry),
        String(caseNum),
        String(category),
      ]
    })

    const buf = await buildXlsx('Toʻlovlar', HEADERS, rows, COL_WIDTHS)
    const filename = `tolovlar-${new Date().toISOString().slice(0, 10)}.xlsx`
    return xlsxResponse(buf, filename)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Eksport xatosi' },
      { status: 500 },
    )
  }
}

export const POST = guard(POST_impl)
