'use client'

/**
 * useFoundCases: one page of the cases the bills job found by number (lib/bill-cases, `/api/found-cases`). Asked again when the job reports
 * new finds (`sud:cases-found`, at most every 3 s) and when it ends; otherwise only when the page, court or search changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getFoundCases } from '@/lib/api-client'
import type { FoundCasesResult } from '@/lib/api-types'
import { CASES_FOUND, CASES_RELOAD, type CasesFoundDetail } from './use-bill-cases'

const REFRESH_MS = 3000

export interface UseFoundCases {
  data: FoundCasesResult | null
  loading: boolean
  error: string | null
}

export function useFoundCases(stir: string, params: { court?: string; q: string; page: number; size: number }): UseFoundCases {
  const [data, setData] = useState<FoundCasesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const pRef = useRef(params)
  pRef.current = params
  const key = JSON.stringify(params)

  const load = useCallback(async () => {
    const mine = ++seq.current
    const res = await getFoundCases(stir, pRef.current)
    if (mine !== seq.current) return
    setLoading(false)
    if (res.ok) {
      setError(null)
      setData(res.data)
    } else setError(res.error)
  }, [stir])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load, key])

  useEffect(() => {
    setData(null)
  }, [stir])

  // the job found something (or ended): read the page again, but not more often than every 3 s
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const soon = () => {
      if (!timer) timer = setTimeout(() => { timer = null; void load() }, REFRESH_MS)
    }
    const onFound = (e: Event) => {
      const d = (e as CustomEvent<CasesFoundDetail>).detail
      if (d && d.stir === stir) soon()
    }
    window.addEventListener(CASES_FOUND, onFound)
    window.addEventListener(CASES_RELOAD, soon)
    return () => {
      window.removeEventListener(CASES_FOUND, onFound)
      window.removeEventListener(CASES_RELOAD, soon)
      if (timer) clearTimeout(timer)
    }
  }, [stir, load])

  return { data, loading, error }
}
