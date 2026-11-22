'use client'

/**
 * Under the cases list of a company whose court list is cut at the court's row limit: the cases the bills name and the list lacks.
 * Everything here is started by a click (nothing reads the bills or asks the court by itself). The server remembers what it found, so
 * the same button simply continues where the last run stopped.
 */

import { toast } from 'sonner'
import { useBillCases } from '@/hooks/use-bill-cases'

const BATCH = 60

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function BillCasesPanel({ stir, capped }: { stir: string; capped: boolean }) {
  const { status, busy, text, start: run, stop } = useBillCases(stir)

  const start = async (scan: 'auto' | 'force' | 'skip', limit: number) => {
    const { found, error } = await run(scan, limit)
    if (error) toast.error(`Toʻlovlardan ishlarni topib boʻlmadi: ${error}. Topilganlari saqlandi.`, { position: 'top-left' })
    else if (found > 0) toast.success(`${found} ta ish topildi va saqlandi`, { position: 'top-left' })
    if (found > 0) window.dispatchEvent(new Event('sud:cases-reload')) // the company's list reads its stored rows again
  }

  if (!capped && !status?.scanned) return null

  return (
    <div className="dw-orders-empty" style={{ marginBottom: 10 }}>
      {!status?.scanned ? (
        <>
          Sud tizimi bu STIR boʻyicha roʻyxatni cheklaydi (yangi tizim 100 ta, eski tizim 200 ta qator): eski ishlar koʻrinmasligi mumkin. Bir marta koʻrilgan ish serverda saqlanadi va roʻyxatdan yoʻqolmaydi. Toʻlovlar (billing.sud.uz) har bir ishning raqamini beradi: yetishmayotgan ishlarni shu raqamlar orqali olish mumkin.
        </>
      ) : (
        <>
          Toʻlovlarda {fmt(status.billCases)} ta ish raqami bor: {fmt(status.found)} tasi olingan, {fmt(status.missing)} tasi hali olinmagan
          {status.notFound > 0 ? `, ${fmt(status.notFound)} tasi sud tizimida topilmadi` : ''}.
          {!status.complete ? ` Toʻlovlar toʻliq oʻqilmagan (${status.pagesDone}/${status.totalPages}-sahifa).` : ''}
        </>
      )}
      {busy && <div style={{ marginTop: 8, color: 'var(--text-2)' }}>{text}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {busy ? (
          <button className="btn btn-outline btn-sm" onClick={stop}>Toʻxtatish</button>
        ) : !status?.scanned || !status.complete ? (
          <button className="btn btn-outline btn-sm" onClick={() => void start('auto', BATCH)}>
            {status?.scanned ? 'Toʻlovlarni oʻqishni davom ettirish' : 'Toʻlovlardan ishlarni topish'}
          </button>
        ) : (
          <>
            {status.missing > 0 && (
              <>
                <button className="btn btn-outline btn-sm" onClick={() => void start('skip', BATCH)}>Yana {Math.min(BATCH, status.missing)} ta ishni olish</button>
                <button className="btn btn-outline btn-sm" onClick={() => void start('skip', 100_000)}>Toʻxtatguncha olish</button>
              </>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => void start('force', 0)}>Toʻlovlarni qayta oʻqish</button>
          </>
        )}
      </div>
    </div>
  )
}
