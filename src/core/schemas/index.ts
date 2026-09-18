/**
 * Zod schemas for every payload that crosses a boundary (blueprint §3.1, §5.6):
 *  - API route OUTPUTS (validated on the way out; client imports the inferred types)
 *  - Client→API query params (validated on the way in by route handlers)
 *
 * Shapes MIRROR the existing server contracts exactly (arch guide invariant §2.2):
 * they name what already ships — they do not change it.
 */
import { z } from 'zod'

// ---- Shared -------------------------------------------------------------

export const StirQuery = z.string().trim().regex(/^\d{9}$/, "STIR aynan 9 ta raqamdan iborat boʻlishi kerak")
export const PinflQuery = z.string().trim().regex(/^\d{14}$/, "PINFL aynan 14 ta raqamdan iborat boʻlishi kerak")
export const CourtTypeQuery = z.enum(['economic', 'civil', 'criminal', 'administrative'])
export const StatsCourtTypeQuery = z.enum(['economic', 'civil', 'administrative'])

// ---- Company info (orginfo + chamber) ------------------------------------

export const CompanyInfoSchema = z.object({
  tin: z.string(),
  officialName: z.string(),
  shortName: z.string(),
  registeredDate: z.string(),
  status: z.string(),
  address: z.string(),
  director: z.string(),
  phone: z.string(),
  email: z.string(),
  charterCapital: z.string(),
  registeringAuthority: z.string(),
  thsht: z.string(),
  dbibt: z.string(),
  ifut: z.string(),
  founders: z.array(z.object({ name: z.string(), share: z.string() }).passthrough()).catch([]),
  orgInfoUrl: z.string(),
}).passthrough()

export const ChamberRatingSchema = z.object({
  score: z.unknown().nullable().catch(null),
  category: z.string().nullable().catch(null),
  taxpayerType: z.string().nullable().catch(null),
  region: z.string().nullable().catch(null),
  district: z.string().nullable().catch(null),
  okedCode: z.string().nullable().catch(null),
  okedName: z.string().nullable().catch(null),
  okedNameRu: z.string().nullable().catch(null),
  okedSection: z.string().nullable().catch(null),
  okedShortName: z.string().nullable().catch(null),
  employeeLimitMf: z.unknown().nullable().catch(null),
  employeeLimitLf: z.unknown().nullable().catch(null),
}).passthrough()

export const CompanyInfoResponseSchema = z.object({
  ok: z.literal(true),
  company: CompanyInfoSchema.nullable(),
  rating: ChamberRatingSchema.nullable(),
})

// ---- Court cases ----------------------------------------------------------

export const CourtCaseSchema = z.object({
  caseNumber: z.string(),
  caseType: z.string().catch(''),
  caseStatus: z.string().catch(''),
  result: z.string().catch(''),
  courtName: z.string().catch(''),
  dateFiled: z.string().catch(''),
  plaintiff: z.string().catch(''),
  defendant: z.string().catch(''),
  claimAmount: z.string().catch(''),
  hearingDate: z.string().catch(''),
  hearingTime: z.string().catch(''),
  judge: z.string().catch(''),
}).passthrough()

export const CourtCasesResponseSchema = z.object({
  ok: z.literal(true),
  cases: z.array(CourtCaseSchema),
})

// ---- Stats (multi-source, partial-aware) -----------------------------------

export const CaseWithClassificationSchema = z.object({
  caseNumber: z.string(),
  courtType: StatsCourtTypeQuery,
  regDate: z.string(),
  result: z.string(),
  classification: z.enum(['win', 'lose', 'neutral', 'pending']),
  role: z.enum(['plaintiff', 'defendant']),
  court: z.string(),
  category: z.string(),
  counterparty: z.string(),
})

export const CompanyStatsSchema = z.object({
  company: z.object({
    name: z.string(),
    tin: z.string(),
    region: z.string().optional(),
    status: z.string().optional(),
    officialName: z.string().optional(),
    shortName: z.string().optional(),
  }).passthrough(),
  cases: z.array(CaseWithClassificationSchema),
  summary: z.object({
    total: z.number(),
    win: z.number(),
    lose: z.number(),
    neutral: z.number(),
    pending: z.number(),
    asPlaintiff: z.number(),
    asDefendant: z.number(),
  }),
  errors: z.array(z.object({ courtType: StatsCourtTypeQuery, error: z.string() })),
  // v204 (P-E): chamber.uz contractor rating threaded through the stats payload
  rating: z
    .object({
      score: z.number(),
      category: z.string(),
    })
    .nullable()
    .optional(),
})

export const StatsResponseSchema = z.object({
  ok: z.literal(true),
  company: CompanyStatsSchema.shape.company,
  cases: CompanyStatsSchema.shape.cases,
  summary: CompanyStatsSchema.shape.summary,
  errors: CompanyStatsSchema.shape.errors,
  rating: CompanyStatsSchema.shape.rating,
})

// ---- Bills ------------------------------------------------------------------

export const EnrichedBillSchema = z.object({
  invoiceNumber: z.string(),
  status: z.string().nullable().catch(null),
  courtType: z.string().nullable().catch(null),
  courtName: z.string().nullable().catch(null),
  category: z.string().nullable().catch(null),
  caseNumber: z.string().nullable().catch(null),
  totalAmount: z.number().nullable().catch(null),
  paidAmount: z.number().nullable().catch(null),
  balanceDue: z.number().nullable().catch(null),
  overdueAmount: z.number().nullable().catch(null),
  inFavorAmount: z.number().nullable().catch(null),
  createdAt: z.number().nullable().catch(null),
  updatedAt: z.number().nullable().catch(null),
}).passthrough()

export const BillSummarySchema = z.object({
  count: z.number(),
  paid: z.number(),
  partial: z.number(),
  unpaid: z.number(),
  other: z.number(),
  totalTiyins: z.number(),
  paidTiyins: z.number(),
  overdueTiyins: z.number(),
}).passthrough()

// ---- Hearings ----------------------------------------------------------------

export const Jadval2HearingSchema = z.object({
  caseNumber: z.string(),
  courtName: z.string(),
  hearingDate: z.string(),
  hearingTime: z.string(),
  judge: z.string().catch(''),
  courtroom: z.string().catch(''),
  status: z.string().catch(''),
  plaintiff: z.string().catch(''),
  defendant: z.string().catch(''),
  caseType: z.string().catch(''),
}).passthrough()

// ---- MIB ----------------------------------------------------------------------

export const MibDebtSchema = z.object({
  tin: z.string(),
  hasDebt: z.boolean().catch(false),
  totalDebt: z.string().catch('0'),
  debts: z.array(z.object({
    number: z.string().catch(''),
    debtAmount: z.string().catch(''),
    penaltyAmount: z.string().catch(''),
    totalAmount: z.string().catch(''),
    detail: z.unknown().optional(),
  }).passthrough()).catch([]),
  checkedAt: z.string().optional().catch(undefined),
}).passthrough()

// ---- Health / workers -----------------------------------------------------------

export const SourceErrorSchema = z.object({
  source: z.string(),
  error: z.string(),
})
