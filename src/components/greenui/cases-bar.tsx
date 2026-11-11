'use client'

/**
 * The toolbar of Sud ishlari in the green look: two deliberate rows instead of one wrapping strip. Row one is what you
 * type and what you do (search, sort, the three exports); row two is what you narrow by (court, side). The controls
 * themselves are passed in by sections/cases, which owns their state.
 */

import type { ReactNode } from 'react'

export function GreenCasesBar({ search, sort, actions, courts, sides, shown, total }: {
  search: ReactNode
  sort: ReactNode
  actions: ReactNode
  courts: ReactNode
  sides: ReactNode
  shown: number
  total: number
}) {
  return (
    <div className="gx-bar">
      <div className="gx-bar-r1">
        {search}
        {sort}
        <span className="gx-bar-n">{shown === total ? `${total} ta ish` : `${shown} / ${total} ta ish`}</span>
        <div className="gx-bar-acts">{actions}</div>
      </div>
      <div className="gx-bar-r2">
        {courts}
        {sides}
      </div>
    </div>
  )
}
