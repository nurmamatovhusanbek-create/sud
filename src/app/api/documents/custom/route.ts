import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { TemplateError, deleteCustom, listCustom, saveCustom } from '@/lib/documents/custom.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/documents/custom — the operator's own .docx templates (stored on this machine, see custom.server.ts)
 *   GET    → the saved templates (id, title, fields)
 *   POST   → multipart { file: .docx, title } → saved; the `{{markers}}` found become the form's fields   [privileged]
 *   DELETE → ?id=custom_…                                                                                    [privileged]
 */
export const GET = guard(async () => NextResponse.json({ ok: true, data: await listCustom() }), { rateLimit: false })

export const POST = guard(
  async (req: NextRequest) => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ ok: false, error: 'Notoʻgʻri soʻrov' }, { status: 400 })
    }
    const file = form.get('file')
    const title = String(form.get('title') ?? '').trim()
    if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: 'Fayl tanlanmadi' }, { status: 400 })
    if (!title) return NextResponse.json({ ok: false, error: 'Shablon nomi kerak' }, { status: 400 })
    try {
      const saved = await saveCustom(Buffer.from(await file.arrayBuffer()), title)
      return NextResponse.json({ ok: true, data: saved })
    } catch (e) {
      if (e instanceof TemplateError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
      return NextResponse.json({ ok: false, error: 'Shablonni saqlab boʻlmadi' }, { status: 500 })
    }
  },
  { privileged: true },
)

export const DELETE = guard(
  async (req: NextRequest) => {
    try {
      await deleteCustom(req.nextUrl.searchParams.get('id') ?? '')
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof TemplateError ? e.message : 'Oʻchirib boʻlmadi' }, { status: 400 })
    }
  },
  { privileged: true },
)
