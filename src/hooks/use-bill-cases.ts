'use client'

/**
 * useBillCases: the cases a company's court bills name and its TIN list lacks (lib/bill-cases). Reads what the server already knows on
 * mount (disk only), and runs a scan / fill ONLY when `start` is called from a click. The server keeps what it found, so a later `start`
 * continues where the last one stopped.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBillCasesStatus, streamBillCases } from '@/lib/api-client'
import type { BillCasesStatus } from '@/lib/api-types'

export interface BillCasesRun {
  /** cases found by number in this run */
  found: number
  /** the reason the run stopped early, when it did (what was found is kept) */
  error: string | null
}

export interface UseBillCases {
  status: BillCasesStatus | null
  busy: boolean
  /** what the run is doing now */
  text: string
  start: (scan: 'auto' | 'force' | 'skip', limit: number) => Promise<BillCasesRun>
  stop: () => void
}

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function useBillCases(stir: string): UseBillCases {
  const [status, setStatus] = useState<BillCasesStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    const res = await getBillCasesStatus(stir)
    if (res.ok) setStatus(res.data)
  }, [stir])

  useEffect(() => {
    setStatus(null)
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  const start = useCallback(
    async (scan: 'auto' | 'force' | 'skip', limit: number): Promise<BillCasesRun> => {
      const ac = new AbortController()
      abortRef.current = ac
      setBusy(true)
      setText('Boshlanmoqda…')
      let found = 0
      let error: string | null = null
      await streamBillCases(stir, { scan, limit }, (e) => {
        if (e.type === 'phase') setText(e.detail)
        else if (e.type === 'scan') setText(`Toʻlovlar oʻqildi: ${e.page}/${e.pages}-sahifa · ${fmt(e.cases)} ta ish raqami`)
        else if (e.type === 'case') {
          if (e.found) found++
          setText(`Ishlar olinmoqda: ${e.index}/${e.of} · ${found} tasi topildi`)
        } else if (e.type === 'done') {
          setStatus(e.status)
          found = e.found
        } else if (e.type === 'error') error = e.error
      }, ac.signal)
      abortRef.current = null
      setBusy(false)
      setText('')
      await load()
      return { found, error }
    },
    [stir, load],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { status, busy, text, start, stop }
}
