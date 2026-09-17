'use client'

/**
 * Identity warming (redesign §5.4): the ONE allowed data-flow change.
 * When a company is resolved, prefetch the cheap identity (name + status +
 * rating) so the context bar fills immediately; heavier section scrapes fire
 * lazily when their section is first opened.
 */

import { getCompanyInfo } from '@/lib/api-client'
import { useAppStore } from '@/lib/store/app-store'
import { updateName } from '@/lib/registry'
import type { CompanyInfoData } from '@/lib/api-types'

let warmedFor: string | null = null

export function keepIdentityWarm(): void {
  if (typeof window === 'undefined') return
  const check = () => {
    const company = useAppStore.getState().activeCompany
    if (!company || company.stir === warmedFor) return
    warmedFor = company.stir
    void (async () => {
      const res = await getCompanyInfo(company.stir)
      if (res.ok) {
        const data = res.data as CompanyInfoData
        const name = data.company?.shortName || data.company?.officialName
        const patch: Record<string, unknown> = {}
        if (name) {
          patch.name = name
          updateName(company.stir, name)
        }
        if (data.company?.status) patch.status = data.company.status
        if (data.rating?.category) {
          patch.rating = {
            category: data.rating.category,
            score: typeof data.rating.score === 'number' ? data.rating.score : null,
          }
        }
        if (Object.keys(patch).length) useAppStore.getState().patchCompany(patch)
      }
    })()
  }
  // Subscribe to store changes; check on every change + immediately
  useAppStore.subscribe(check)
  check()
}
