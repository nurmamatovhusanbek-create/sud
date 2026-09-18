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
 */
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

      return {
        'Kvitansiya': b.number || '-',
        'Kompaniya': b.companyName || '-',
        'Summa': String(amount),
        "Toʻlangan": String(paid),
        "Toʻlanmagan": String(unpaid),
        'Holati': status === 'PAID' ? "Toʻlangan" : status === 'PARTIAL' ? "Qisman" : status === 'UNPAID' ? "Toʻlanmagan" : status,
        'Sud': court,
        'Berilgan sana': issued,
        'Amal qilish': expiry,
        'Ish raqami': caseNum,
        'Turi': category,
      }
    })

    // v204 (P-C): shared minimal .xlsx builder (was a duplicated JSZip block)
    const headers = ['Kvitansiya', 'Kompaniya', 'Summa', "Toʻlangan", "Toʻlanmagan", 'Holati', 'Sud', 'Berilgan sana', 'Amal qilish', 'Ish raqami', 'Turi']
    const colWidths = [22, 35, 15, 15, 15, 12, 40, 14, 14, 22, 18]
    const buf = await buildXlsx('Toʻlovlar', headers, rows, colWidths)
    const filename = `tolovlar-${new Date().toISOString().slice(0, 10)}.xlsx`
    return xlsxResponse(buf, filename)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Export failed' },
      { status: 500 },
    )
  }
}

export const POST = guard(POST_impl)
