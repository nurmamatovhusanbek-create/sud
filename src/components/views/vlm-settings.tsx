'use client'

/**
 * Settings › Captcha (VLM) — the vision model that reads billing.sud.uz's arithmetic captcha. Every operator brings
 * their own key: pick a provider (Z.ai, Groq or any OpenAI-compatible one), paste the key, press «Sinash». The test
 * sends two small pictures with a known answer, so it proves the key is accepted AND that the model can read images
 * (a text-only model is told apart from a wrong key). The key is stored on this computer only and is never shown again.
 */

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FlaskConical, Trash2, XCircle, ScanEye } from 'lucide-react'
import { toast } from 'sonner'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'
import { VLM_PRESETS, presetOf, type VlmFailure, type VlmProvider } from '@/core/vlm'

interface Status {
  configured: boolean
  source: 'saved' | 'env' | 'none'
  provider?: VlmProvider
  baseUrl?: string
  model?: string
  keyHint?: string
}
interface TestOut {
  ok: boolean
  reason?: VlmFailure | 'weak'
  detail?: string
  correct: number
  asked: number
  ms: number
}

const REASON: Record<string, string> = {
  bad_key: 'Kalit qabul qilinmadi (401/403): kalitni tekshiring',
  bad_model: 'Bunday model topilmadi: model nomini tekshiring',
  not_vision: 'Kalit ishlaydi, lekin bu model rasm oʻqiy olmaydi: vision modelini tanlang',
  rate_limited: 'Limit tugadi yoki juda tez (429): kalit yaroqli, birozdan soʻng qayta sinang',
  http_error: 'Taʼminotchi xato qaytardi',
  network: 'Taʼminotchiga ulanib boʻlmadi',
  timeout: 'Javob kelmadi (vaqt tugadi)',
  empty: 'Model boʻsh javob qaytardi',
  weak: 'Model rasmni oʻqidi, lekin javoblari notoʻgʻri: kuchliroq vision modelini tanlang',
}

const unwrap = async <T,>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null
  return j && j.ok && j.data ? { ok: true, data: j.data } : { ok: false, error: j?.error || `HTTP ${res.status}` }
}

export function VlmTab() {
  const [status, setStatus] = useState<Status | null>(null)
  const [provider, setProvider] = useState<VlmProvider>('zai')
  const [baseUrl, setBaseUrl] = useState(presetOf('zai').baseUrl)
  const [model, setModel] = useState(presetOf('zai').model)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [out, setOut] = useState<TestOut | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await unwrap<Status>(await fetch('/api/settings/vlm', { headers: authHeaders() }))
      if (r.ok && typeof r.data.configured === 'boolean') {
        setStatus(r.data)
        if (r.data.source === 'saved' && r.data.provider) {
          setProvider(r.data.provider)
          setBaseUrl(r.data.baseUrl ?? '')
          setModel(r.data.model ?? '')
        }
      }
    } catch {
      /* the form still works without it */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const pick = (p: VlmProvider) => {
    const pr = presetOf(p)
    setProvider(p)
    setBaseUrl(pr.baseUrl)
    setModel(pr.model)
    setOut(null)
  }

  const body = () => JSON.stringify({ provider, baseUrl, model, apiKey })
  const haveKey = !!apiKey.trim() || status?.source === 'saved'

  async function test() {
    setBusy('test')
    setOut(null)
    const id = toast.loading('Kalit va model sinalmoqda…')
    try {
      const res = await fetch('/api/settings/vlm/test', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: body() })
      const r = await unwrap<TestOut>(res)
      if (!r.ok || typeof r.data.ok !== 'boolean') {
        toast.error(`Sinov oʻtmadi: ${r.ok ? 'javob shakli notoʻgʻri' : r.error}`, { id })
        return
      }
      setOut(r.data)
      if (r.data.ok) toast.success(`Ishlayapti: model rasmni oʻqiydi · ${r.data.ms} ms`, { id })
      else toast.error(REASON[r.data.reason ?? ''] ?? 'Sinov oʻtmadi', { id })
    } catch {
      toast.error('Sinovni oʻtkazib boʻlmadi', { id })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setBusy('save')
    try {
      const res = await fetch('/api/settings/vlm', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: body() })
      const r = await unwrap<Status>(res)
      if (r.ok) {
        setStatus(r.data)
        setApiKey('')
        toast.success('Saqlandi: captcha shu kalit bilan oʻqiladi')
      } else toast.error(`Saqlanmadi: ${r.error}`)
    } catch {
      toast.error('Saqlab boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  async function forget() {
    try {
      const res = await fetch('/api/settings/vlm', { method: 'DELETE', headers: privilegedHeaders() })
      const r = await unwrap<Status>(res)
      if (r.ok) {
        setStatus(r.data)
        setOut(null)
        toast.success('Kalit oʻchirildi')
      }
    } catch {
      toast.error('Oʻchirib boʻlmadi')
    }
  }

  const pr = presetOf(provider)

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><ScanEye /></div>
          <h2>Captcha oʻqish (VLM)</h2>
          {status?.configured && (
            <span className="badge b-pos" style={{ marginLeft: 'auto' }}>
              {status.source === 'saved' ? `Saqlangan · ${status.keyHint}` : `Muhit oʻzgaruvchisi · ${status.keyHint}`}
            </span>
          )}
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
          billing.sud.uz baʼzan arifmetik rasm-captcha soʻraydi; uni rasm oʻqiy oladigan (vision) model yechadi. Har bir foydalanuvchi oʻz kalitini kiritadi:
          kalit faqat shu kompyuterda (<span className="mono">~/.sud-tizimi/vlm.json</span>) saqlanadi, brauzerga qaytarilmaydi va hech qachon gitga tushmaydi.
          {!status?.configured && ' Hozircha kalit yoʻq: captcha talab qilinsa hisob-kitob (toʻlovlar) olinmaydi.'}
        </p>

        <div className="p-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {VLM_PRESETS.map((x) => (
            <button key={x.provider} className={`btn btn-sm ${provider === x.provider ? 'btn-primary' : 'btn-outline'}`} onClick={() => pick(x.provider)}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
          {pr.note}
          {pr.keyPage ? <> Kalit: <span className="mono">{pr.keyPage}</span>.</> : null}
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          <label className="field" style={{ height: 40 }}>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Manzil: https://…/v1" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
          </label>
          <label className="field" style={{ height: 40 }}>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model nomi (rasm qabul qiladigan)" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
          </label>
          <label className="field" style={{ height: 40 }}>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status?.source === 'saved' ? `API kalit (${status.keyHint}) — oʻzgartirmaslik uchun boʻsh qoldiring` : 'API kalit'}
              spellCheck={false}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
          </label>
        </div>

        <div className="p-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn btn-outline" onClick={() => void test()} disabled={!haveKey || !baseUrl.trim() || !model.trim() || !!busy}>
            {busy === 'test' ? <span className="spinner" /> : <FlaskConical />}
            Sinash
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!haveKey || !baseUrl.trim() || !model.trim() || !!busy}>
            {busy === 'save' ? <span className="spinner" /> : null}
            Saqlash
          </button>
          {status?.source === 'saved' && (
            <button className="btn btn-outline" onClick={() => void forget()} disabled={!!busy}>
              <Trash2 />
              Kalitni oʻchirish
            </button>
          )}
        </div>

        {out && (
          <div className="kv" style={{ marginTop: 14 }}>
            <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {out.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {out.ok ? 'Kalit qabul qilindi va model rasmni toʻgʻri oʻqidi' : (REASON[out.reason ?? ''] ?? 'Sinov oʻtmadi')}
            </span>
            <span className={`badge ${out.ok ? 'b-pos' : 'b-warn'}`}>
              {out.correct}/{out.asked} · {out.ms} ms
            </span>
          </div>
        )}
        {out && !out.ok && out.detail && <div className="faint mono" style={{ fontSize: 12, marginTop: 6, wordBreak: 'break-word' }}>{out.detail}</div>}
      </div>
    </div>
  )
}
