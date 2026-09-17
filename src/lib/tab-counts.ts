'use client'

/** Per-section counts shared with the workspace tabs (prototype .tc chips). */
import { create } from 'zustand'

interface TabCountsState {
  bills?: number
  cases?: number
  hearings?: number
  set: (patch: Partial<Omit<TabCountsState, 'set'>>) => void
}

export const useTabCounts = create<TabCountsState>((set) => ({
  bills: undefined,
  cases: undefined,
  hearings: undefined,
  set: (patch) => set(patch),
}))
