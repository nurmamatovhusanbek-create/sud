'use client'

/**
 * One switch per rebuilt list: «Yangi» draws tables and an agenda (components/newui), «Yashil» draws its own cards and
 * timeline (components/greenui/lists). Views call these and never know which look is on; the props are identical.
 */

import type { ComponentProps } from 'react'
import { useUiVersion } from '@/lib/ui-version'
import { CompanyTable } from '@/components/newui/company-table'
import { CaseTable } from '@/components/newui/case-table'
import { Agenda } from '@/components/newui/agenda'
import { GreenAgenda, GreenCases, GreenCompanies } from '@/components/greenui/lists'

export type { AgendaRow } from '@/components/newui/agenda'
export type { CaseTableRow } from '@/components/newui/case-table'

export function CompanyList(props: ComponentProps<typeof CompanyTable>) {
  return useUiVersion() === 'green' ? <GreenCompanies {...props} /> : <CompanyTable {...props} />
}

export function CaseList(props: ComponentProps<typeof CaseTable>) {
  return useUiVersion() === 'green' ? <GreenCases {...props} /> : <CaseTable {...props} />
}

export function AgendaList(props: ComponentProps<typeof Agenda>) {
  return useUiVersion() === 'green' ? <GreenAgenda {...props} /> : <Agenda {...props} />
}
