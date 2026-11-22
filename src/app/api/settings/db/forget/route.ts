import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { forgetCompany } from '@/lib/db-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/settings/db/forget?tin=… → deletes the company's stored bills, found cases and tried numbers (case details stay). [privileged] */
export const POST = guard(
  async (req) => {
    const tin = new URL(req.url).searchParams.get('tin') ?? ''
    if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
    return jsonOk(forgetCompany(tin))
  },
  { privileged: true },
)
