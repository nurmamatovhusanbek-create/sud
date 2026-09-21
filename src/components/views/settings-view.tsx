'use client'

/**
 * Settings — the prototypeʼs full settings VIEW (not a dialog): hero + the
 * three set-tabs. Yangilanishlar → live version/git info; Workerlar → the
 * workers.json registry with test / add / remove; Holat → success-rate arc
 * gauge, request-volume bars, per-worker cards with sparklines and the
 * per-worker request-history drawer. Auto-refresh toggle polls every 5s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  Download,
  FlaskConical,
  GitBranch,
  Plus,
  RefreshCw,
  Server,
  Shield,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { ArcGauge, BarChart, Spark, SkRows, EmptyBlock } from '@/components/proto/primitives'
import { openProtoDrawer } from '@/components/proto/drawer'
import { APP_VERSION } from '@/lib/version'
import { getTorStatus } from '@/lib/api-client'
import { toast } from 'sonner'

// ---- shared shapes --------------------------------------------------------------

interface RequestRecord {
  ts: number
  ok: boolean
  ms: number
  origin: string
}

interface WorkerHealth {
  workerUrl: string
  label: string
  totalRequests: number
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  successRate: number
  lastResponseTimeMs: number | null
  status: 'alive' | 'dead'
  origins: string[]
  history: RequestRecord[]
}

interface HealthData {
  workers: WorkerHealth[]
  summary: {
    totalRequests: number
    totalSuccesses: number
    totalFailures: number
    overallSuccessRate: number
    activeWorkers: number
    deadWorkers: number
    totalWorkers: number
  }
  fetchedAt: string
}

interface WorkerEntry {
  url: string
  addedAt: string | null
  lastTestedAt: string | null
  lastTestResult: 'ok' | 'fail' | null
  lastTestDetail?: string
}

interface WorkersResponse {
  source: 'file' | 'env' | 'fallback'
  workers: WorkerEntry[]
}

interface TestResult {
  ok: boolean
  reason?: string
  status?: number
  responseMs?: number
  caseCount?: number
  detail?: string
}

const REASON_LABELS: Record<string, string> = {
  timeout: 'Vaqt tugadi',
  http_502: '502 Bad Gateway',
  http_5xx: 'Server xatosi (5xx)',
  http_4xx: "Xato soʻrov (4xx)",
  non_json: 'JSON emas',
  html_response: 'HTML sahifa (worker ishlamaydi)',
  wrong_shape: "Notoʻgʻri format",
  network_error: 'Tarmoq xatosi',
  not_https: 'HTTPS emas',
}

// ---- Updates tab ------------------------------------------------------------------

const UPDATE_ERROR_LABELS: Record<string, string> = {
  dirty_tree: "Ish daraxtida oʻzgarishlar bor va ularni vaqtincha yashirib boʻlmadi",
  wrong_branch: "Server 'main' branchida emas — avtomatik yangilash faqat 'main'da ishlaydi",
  git_unavailable: 'Git topilmadi — bu muhitda mavjud emas',
  pull_failed: "git pull amalga oshmadi",
  not_supervised: "Server nazoratchisiz ishga tushirilgan — avtomatik qayta ishga tushirib boʻlmaydi",
}

/** Poll until the server answers again (it genuinely goes offline mid-restart —
 *  connection-refused during that window is expected, not a failure) or the
 *  budget runs out (production mode rebuilds can take a while). */
async function pollForRestart(onTick: (elapsedMs: number) => void): Promise<boolean> {
  const start = Date.now()
  const budgetMs = 120_000
  const intervalMs = 1500
  while (Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, intervalMs))
    onTick(Date.now() - start)
    try {
      const res = await fetch(`/api/settings/version?_=${Date.now()}`, { cache: 'no-store' })
      if (res.ok) return true
    } catch {
      // still restarting — keep polling
    }
  }
  return false
}

function UpdatesTab() {
  const [info, setInfo] = useState<{
    local: { version: string; sha: string | null; branch: string | null; dirty: boolean; gitAvailable: boolean }
    remote: { sha: string; message: string; author: string; date: string; commitUrl: string } | null
    updateAvailable: boolean
  } | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateState, setUpdateState] = useState<'idle' | 'pulling' | 'restarting' | 'timeout'>('idle')
  const [elapsed, setElapsed] = useState(0)

  const load = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch(`/api/settings/version?_=${Date.now()}`)
      setInfo(await res.json())
    } catch {
      setInfo(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runUpdate = useCallback(async () => {
    setUpdateState('pulling')
    let res: Response
    try {
      res = await fetch('/api/settings/update', { method: 'POST' })
    } catch {
      setUpdateState('idle')
      toast.error('Tarmoq xatosi — serverga ulanib boʻlmadi')
      return
    }
    const body = await res.json().catch(() => null)
    if (!body?.ok) {
      setUpdateState('idle')
      const code = body?.error as string | undefined
      toast.error((code && UPDATE_ERROR_LABELS[code]) || body?.detail || 'Yangilash amalga oshmadi')
      return
    }
    if (!body.restarting) {
      // Pulled but HEAD didn't move (nothing new despite the check saying
      // so — e.g. someone else already updated it) — no restart needed.
      setUpdateState('idle')
      toast.success('Allaqachon eng soʻnggi versiyada')
      void load()
      return
    }
    setUpdateState('restarting')
    setElapsed(0)
    const ok = await pollForRestart(setElapsed)
    if (ok) {
      toast.success('Yangilandi — sahifa qayta yuklanmoqda…')
      window.location.reload()
    } else {
      setUpdateState('timeout')
    }
  }, [load])

  const kv = (k: string, v: React.ReactNode) => (
    <div className="kv" key={k}>
      <span className="k">{k}</span>
      {v}
    </div>
  )

  const busy = updateState === 'pulling' || updateState === 'restarting'

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><GitBranch /></div>
          <h3>Joriy versiya</h3>
          <div className="sp" />
          {info && !info.updateAvailable && <span className="badge b-pos"><Check />Eng soʻnggi</span>}
          {info?.updateAvailable && <span className="badge b-warn">Yangilanish bor</span>}
        </div>
        {kv('Versiya', <span className="badge b-neu">{info?.local.version || APP_VERSION}</span>)}
        {kv('Git SHA', <span className="mono">{info?.local.sha || '-'}</span>)}
        {kv('Branch', <span className="mono">{info?.local.branch || 'main'}</span>)}
        {kv("Ish daraxti", <span className="faint">{info ? (info.local.dirty ? "Oʻzgarishlar bor" : "Toza (oʻzgarishsiz)") : '-'}</span>)}
      </div>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Download /></div>
          <h3>GitHubʼdagi soʻnggi</h3>
        </div>
        {kv('SHA', <span className="mono">{info?.remote?.sha?.slice(0, 7) || '-'}</span>)}
        {kv('Commit', <span style={{ fontSize: 12.5, textAlign: 'right', maxWidth: '60%' }}>{info?.remote?.message || '-'}</span>)}
        {kv('Muallif', <span>{info?.remote?.author || '-'}</span>)}
        {kv('Sana', <span className="mono faint">{info?.remote?.date || '-'}</span>)}
        <button className="btn btn-outline" style={{ width: '100%', marginTop: 14 }} onClick={() => void load()} disabled={checking || busy}>
          {checking ? <span className="spinner" /> : <RefreshCw />}
          <span>Qayta tekshirish</span>
        </button>
      </div>
      <div className="p-card rise-c" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 30 }}>
        {updateState === 'pulling' || updateState === 'restarting' ? (
          <div className="empty" style={{ padding: 0 }}>
            <div className="ico" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <span className="spinner" style={{ width: 22, height: 22 }} />
            </div>
            <h3>{updateState === 'pulling' ? 'Yangilanish olinmoqda…' : 'Server qayta ishga tushirilmoqda…'}</h3>
            <p style={{ margin: 0 }}>
              {updateState === 'pulling'
                ? 'git pull ishlamoqda.'
                : `Bu bir necha soniyadan bir necha daqiqagacha davom etishi mumkin (production rejimida qayta build qilinadi). ${Math.round(elapsed / 1000)}s`}
            </p>
          </div>
        ) : updateState === 'timeout' ? (
          <div className="alert warn" style={{ textAlign: 'left' }}>
            <AlertTriangle />
            <div className="at">
              <b>Server hali javob bermayapti</b>
              <p>Qayta ishga tushirish odatdagidan uzoqroq davom etmoqda. Terminaldagi loglarni tekshiring yoki sahifani qoʻlda yangilang.</p>
            </div>
            <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => window.location.reload()}>
              Sahifani yangilash
            </button>
          </div>
        ) : (
          <div className="empty" style={{ padding: 0 }}>
            <div className="ico" style={{ background: 'var(--pos-soft)', color: 'var(--pos-text)' }}>
              <Check />
            </div>
            <h3>{info?.updateAvailable ? 'Yangilanish mavjud' : "Eng soʻnggi versiyada"}</h3>
            <p style={{ margin: '0 0 14px' }}>
              {info?.updateAvailable ? (
                'GitHubʼda yangi commit bor. Yangilash tugmasi orqali oling — server avtomatik qayta ishga tushadi.'
              ) : info ? (
                <>
                  Lokal kod GitHubʼdagi <span className="mono">{info.local.branch || 'main'}</span> bilan bir xil.{' '}
                  <span className="mono">git pull</span> talab etilmaydi.
                </>
              ) : (
                'Versiya ma’lumotlari yuklanmoqda…'
              )}
            </p>
            {info?.updateAvailable && (
              <button className="btn btn-outline btn-sm" onClick={() => void runUpdate()} disabled={busy}>
                <Download />
                <span>Yangilash</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Workers tab ------------------------------------------------------------------

// ---- Tor card (moved out of the topbar — optional infra, lives in Settings) ----
//
// Every scrape already routes through the CF worker pool regardless of Tor,
// so this is informational/optional: a user who never sets Tor up just never
// looks at this card and nothing else in the app nags them about it.

function TorCard() {
  const [state, setState] = useState<'checking' | 'active' | 'inactive'>('checking')

  // manual=true is a click handler (setState there is fine); the mount call
  // below only ever awaits — its state updates land after the await, never
  // synchronously inside the effect body.
  const check = useCallback(async (manual: boolean) => {
    if (manual) {
      setState('checking')
      toast.loading('Tor holati tekshirilmoqda…', { id: 'tor-check', duration: 20_000 })
    }
    try {
      const res = await getTorStatus()
      const running = res.ok && res.data.running
      setState(running ? 'active' : 'inactive')
      if (manual) {
        if (running) toast.success('Tor faol', { id: 'tor-check' })
        else toast.warning("Tor oʻchiq — ixtiyoriy, boshqa hech narsaga taʼsir qilmaydi", { id: 'tor-check' })
      }
    } catch {
      setState('inactive')
      if (manual) toast.error('Tor holatini olib boʻlmadi', { id: 'tor-check' })
    }
  }, [])

  useEffect(() => {
    void check(false)
  }, [check])

  const color = state === 'active' ? 'var(--pos-base)' : state === 'inactive' ? 'var(--neg-base)' : 'var(--warn-base)'
  const label = state === 'active' ? 'Tor faol' : state === 'inactive' ? "Tor oʻchiq" : 'Tekshirilmoqda…'

  return (
    <div className="p-card rise-c" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <div className="ico"><Shield /></div>
        <h3>Tor</h3>
        <div className="sp" />
        <span className="p-dot" style={{ background: color }} />
        <span className="faint" style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      </div>
      <p className="faint" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
        Ixtiyoriy — barcha soʻrovlar Cloudflare workerlar orqali oʻtadi. Tor yoqilmagan boʻlsa ham ilova toʻliq ishlayveradi.
      </p>
      <button className="btn btn-outline btn-sm" onClick={() => void check(true)} disabled={state === 'checking'}>
        {state === 'checking' ? <span className="spinner" /> : <RefreshCw />}
        Tekshirish
      </button>
    </div>
  )
}

function WorkersTab() {
  const [data, setData] = useState<WorkersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [newUrl, setNewUrl] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testOut, setTestOut] = useState<React.ReactNode>(null)
  const [adding, setAdding] = useState(false)

  const fetchWorkers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/workers')
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchWorkers()
  }, [fetchWorkers])

  const testWorker = async (url: string) => {
    setTesting(url)
    setTestOut(null)
    try {
      const res = await fetch('/api/settings/workers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, timeoutMs: 10000 }),
      })
      const result: TestResult = await res.json()
      if (result.ok) {
        toast.success(`${url}: OK · ${result.responseMs ?? '-'}ms${result.caseCount ? ` · ${result.caseCount} ish` : ''}`)
        setTestOut(
          <div className="alert info">
            <FlaskConical />
            <div className="at">
              <b>Test oʻtdi</b>
              <p>
                {result.responseMs ?? '-'}ms{result.caseCount ? ` · ${result.caseCount} ta ish topildi` : ''}
              </p>
            </div>
          </div>,
        )
      } else {
        toast.error(`${url}: xato · ${REASON_LABELS[result.reason ?? ''] || result.reason}`)
        setTestOut(
          <div className="alert warn">
            <AlertTriangle />
            <div className="at">
              <b>{REASON_LABELS[result.reason ?? ''] || result.reason || 'Xato'}</b>
              <p>{result.detail || 'Worker javob berdi, lekin jadvalapi formati mos emas. proxy.js ni tekshiring.'}</p>
            </div>
          </div>,
        )
      }
      if (data?.workers.some((w) => w.url === url)) setTimeout(() => void fetchWorkers(), 500)
    } catch {
      toast.error('Testni oʻtkazib boʻlmadi')
    } finally {
      setTesting(null)
    }
  }

  const addWorker = async () => {
    if (!newUrl.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/settings/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim() }),
      })
      const result = await res.json()
      if (result.ok) {
        setNewUrl('')
        setTestOut(null)
        toast.success('Worker qoʻshildi (workers.json)')
        await fetchWorkers()
      } else {
        const msgs: Record<string, string> = {
          invalid_url: "URL notoʻgʻri. HTTPS boʻlishi kerak",
          duplicate: 'Bu worker allaqachon mavjud',
          missing_url: 'URL kiriting',
        }
        toast.error(msgs[result.error] || 'Xato yuz berdi')
      }
    } catch {
      toast.error('Qoʻshib boʻlmadi')
    } finally {
      setAdding(false)
    }
  }

  const removeWorker = async (url: string) => {
    try {
      await fetch(`/api/settings/workers?url=${encodeURIComponent(url)}`, { method: 'DELETE' })
      toast(`${url} oʻchirildi`)
      await fetchWorkers()
    } catch {
      toast.error("Oʻchirib boʻlmadi")
    }
  }

  if (loading && !data) return (
    <div>
      <TorCard />
      <SkRows n={4} />
    </div>
  )

  const src = data?.source === 'file' ? 'workers.json' : data?.source === 'env' ? '.env' : 'Birlamchi'

  return (
    <div>
      <TorCard />
      <div className="p-card rise-c" style={{ padding: 8 }}>
        <div className="filterbar" style={{ margin: '8px 8px 4px' }}>
          <span className="badge b-neu"><Server />Manba: {src}</span>
          <span className="faint" style={{ fontSize: 12 }}>{data?.workers.length ?? 0} worker</span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText('// proxy.js · cloudflare-worker/proxy.js faylini koʻring')
              toast.success('Worker kodi nusxalandi (proxy.js)')
            }}
          >
            <Server />
            <span>Kodni nusxalash</span>
          </button>
        </div>
        <div className="list">
          {(data?.workers ?? []).length === 0 && (
            <div className="empty" style={{ padding: 26 }}>
              <div className="ico"><Server /></div>
              <h3>Worker yoʻq</h3>
              <p>Quyidagi shakl orqali birinchi Cloudflare workerʼni qoʻshing.</p>
            </div>
          )}
          {(data?.workers ?? []).map((w) => (
            <div className="lrow" style={{ cursor: 'default' }} key={w.url}>
              <span className={`p-dot ${w.lastTestResult === 'ok' ? 'd-pos' : w.lastTestResult === 'fail' ? 'd-neg' : 'd-neu'}`} style={{ marginLeft: 6 }} />
              <div className="main-c">
                <b className="mono">{w.url}</b>
                <div className="sub">
                  {w.lastTestedAt
                    ? w.lastTestResult === 'ok'
                      ? `Soʻnggi test: OK`
                      : `Soʻnggi test: xato · ${w.lastTestDetail || ''}`
                    : 'Hali test qilinmagan'}
                </div>
              </div>
              {w.lastTestResult === 'ok' ? (
                <span className="badge b-pos"><Check />OK</span>
              ) : w.lastTestResult === 'fail' ? (
                <span className="badge b-neg"><X />Xato</span>
              ) : null}
              <button className="btn btn-ghost btn-sm" onClick={() => void testWorker(w.url)}>
                {testing === w.url ? <span className="spinner" /> : <FlaskConical />}
                Sinash
              </button>
              <button className="kebab" onClick={() => void removeWorker(w.url)} aria-label="Oʻchirish">
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="p-card rise-c" style={{ marginTop: 16 }}>
        <div className="card-h">
          <div className="ico"><Plus /></div>
          <h3>Yangi worker qoʻshish</h3>
        </div>
        <div className="p-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ height: 40, flex: 1, minWidth: 220 }}>
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://sud-proxy-5.workers.dev"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
          </label>
          <button className="btn btn-outline" onClick={() => newUrl.trim() && void testWorker(newUrl.trim())} disabled={!newUrl.trim() || !!testing}>
            <FlaskConical />
            Sinash
          </button>
          <button className="btn btn-primary" onClick={() => void addWorker()} disabled={!newUrl.trim() || adding}>
            {adding ? <span className="spinner" /> : null}
            Qoʻshish
          </button>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
          <span className="mono">{src}</span> ga saqlanadi. Qayta ishga tushirish shart emas.
        </div>
        {testOut && <div style={{ marginTop: 12 }}>{testOut}</div>}
      </div>
    </div>
  )
}

// ---- Health tab ------------------------------------------------------------------

// v208: time-span pills are real now — each window filters the per-worker
// request history client-side (success rate, volume, avg latency all follow).
type Span = 'today' | '7d' | '30d' | 'all'
const SPANS: { value: Span; short: string; label: string; ms: number | null }[] = [
  { value: 'today', short: 'Bugun', label: 'soʻnggi 24 soat', ms: 24 * 3600 * 1000 },
  { value: '7d', short: '7 kun', label: 'soʻnggi 7 kun', ms: 7 * 24 * 3600 * 1000 },
  { value: '30d', short: '30 kun', label: 'soʻnggi 30 kun', ms: 30 * 24 * 3600 * 1000 },
  { value: 'all', short: 'Barcha', label: 'barcha davr', ms: null },
]

function HealthTab() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [auto, setAuto] = useState(false)
  const [span, setSpan] = useState<Span>('today')

  const load = useCallback(async () => {
    setLoading(true) // v208: "Qayta urinish" now shows the skeleton while retrying
    try {
      const res = await fetch('/api/settings/health')
      const json = (await res.json()) as HealthData & { ok?: boolean }
      if (json && (json.ok || json.workers)) setData(json)
    } catch {
      /* keep previous */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [auto, load])

  // v208: derive everything from the span-filtered history (was: server
  // summary only — the pills could not change anything by design).
  const workers = useMemo(() => {
    const ms = SPANS.find((s) => s.value === span)?.ms ?? null
    const now = Date.now()
    return (data?.workers ?? []).map((w) => {
      const h = ms == null ? w.history : w.history.filter((r) => now - r.ts <= ms)
      const ok = h.filter((r) => r.ok).length
      return { ...w, history: h, totalRequests: h.length, successRate: h.length ? ok / h.length : 0 }
    })
  }, [data, span])

  const summary = data?.summary
  const rate = useMemo(() => {
    const tot = workers.reduce((a, w) => a + w.totalRequests, 0)
    if (!tot) return 0
    return Math.round((workers.reduce((a, w) => a + w.history.filter((r) => r.ok).length, 0) / tot) * 100)
  }, [workers])
  const spanLabel = SPANS.find((s) => s.value === span)?.label ?? ''
  const alive = summary?.activeWorkers ?? 0
  const total = summary?.totalWorkers ?? 0
  const totalReqs = workers.reduce((a, w) => a + w.totalRequests, 0)
  const avgMs = useMemo(() => {
    const all = workers.flatMap((w) => w.history)
    if (!all.length) return 0
    return Math.round(all.reduce((a, r) => a + r.ms, 0) / all.length)
  }, [workers])

  // Request volume across workers (per-worker buckets → bar chart)
  const vol = useMemo(() => {
    if (!workers.length) return { data: [0], labels: ['-'] }
    return {
      data: workers.map((w) => w.totalRequests),
      labels: workers.map((w, i) => w.label?.slice(0, 10) || `W${i + 1}`),
    }
  }, [workers])
  const hotVol = vol.data.indexOf(Math.max(...vol.data))

  const openWorker = (w: WorkerHealth) => {
    const failIdx = w.history.map((h, i) => (h.ok ? -1 : i)).filter((i) => i >= 0)
    openProtoDrawer(
      w.label || w.workerUrl,
      <div>
        <div style={{ marginBottom: 16, display: 'flex', gap: 6 }}>
          <span className={`badge ${w.successRate >= 0.9 ? 'b-pos' : w.successRate >= 0.6 ? 'b-warn' : 'b-neg'}`} style={{ height: 28 }}>
            Muvaffaqiyat {Math.round(w.successRate * 100)}%
          </span>
          <span className="badge b-neu" style={{ height: 28 }}>{w.totalRequests} soʻrov</span>
          <span className={`badge ${w.status === 'alive' ? 'b-pos' : 'b-neg'}`} style={{ height: 28 }}>{w.status === 'alive' ? 'Faol' : "Oʻlik"}</span>
        </div>
        <div className="detail-sec">
          <span className="eyebrow">Soʻnggi soʻrovlar</span>
          {w.history.slice(-12).reverse().map((r, i) => (
            <div className="reqline" key={i}>
              <span className={`p-dot ${r.ok ? 'd-pos' : 'd-neg'}`} />
              <span className="mono faint">{new Date(r.ts).toLocaleTimeString('uz-UZ', { hour12: false })}</span>
              <span style={{ flex: 1, fontSize: 12 }}>{r.origin}</span>
              {r.ok ? <span className="mono faint">{r.ms}ms</span> : <span className="badge b-neg" style={{ height: 20 }}>xato</span>}
            </div>
          ))}
          {w.history.length === 0 && <div className="faint" style={{ fontSize: 12 }}>Tarix boʻsh</div>}
        </div>
        <div className="detail-sec">
          <span className="eyebrow">Faollik</span>
          <div className="spark" style={{ height: 44 }}>
            {w.history.slice(-24).map((r, i) => (
              <i key={i} className={r.ok ? '' : 'f'} style={{ height: Math.min(44, 10 + r.ms / 8) }} />
            ))}
          </div>
        </div>
        <button
          className="btn btn-outline"
          style={{ width: '100%' }}
          onClick={() => toast(`${w.label || w.workerUrl}: test yuborildi`)}
        >
          <FlaskConical />
          <span>Workerni sinash</span>
        </button>
      </div>,
      w.workerUrl,
    )
  }

  if (loading && !data) return <SkRows n={4} />
  if (!data)
    return <EmptyBlock icon={<Activity />} title="Holat olinmadi" hint="Server /api/settings/health javob bermadi." action={<button className="btn btn-outline btn-sm" onClick={() => void load()}>Qayta urinish</button>} />

  return (
    <div>
      <div className="filterbar">
        <div className="seg">
          {SPANS.map((s) => (
            <button key={s.value} className={span === s.value ? 'on' : ''} onClick={() => setSpan(s.value)}>
              {s.short}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="p-row" style={{ gap: 8 }}>
          <span className="faint" style={{ fontSize: 12 }}>Avto-yangilash (5s)</span>
          <button className={`toggle ${auto ? 'on' : ''}`} id="autoR" onClick={() => setAuto((a) => !a)} aria-label="Avto-yangilash" />
        </div>
      </div>

      <div className="dash" style={{ gridTemplateColumns: '1fr 1.15fr' }}>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Activity /></div>
            <h3>Umumiy holat</h3>
            <div className="sp" />
            <span className={`badge ${rate >= 80 ? 'b-pos' : 'b-warn'}`}>{rate >= 80 ? "Sogʻlom" : 'Beqaror'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
            <ArcGauge pct={rate} size={220} band={rate >= 80 ? 'pos' : 'warn'} label={`Muvaffaqiyat darajasi · ${spanLabel}`} />
          </div>
          <div className="health-grid" style={{ marginTop: 8 }}>
            <div>
              <div className="lbl" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', fontWeight: 600 }}>
                Jami soʻrov
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{totalReqs}</div>
            </div>
            <div>
              <div className="lbl" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', fontWeight: 600 }}>
                Oʻrtacha javob
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                {avgMs}
                <span style={{ color: 'var(--text-3)', fontSize: 14 }}>ms</span>
              </div>
            </div>
            <div>
              <div className="lbl" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', fontWeight: 600 }}>
                Faol worker
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                {alive}
                <span style={{ color: 'var(--text-3)', fontSize: 14 }}>/{total}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Zap /></div>
            <h3>Soʻrov hajmi</h3>
            <div className="sp" />
            <span className="faint" style={{ fontSize: 12 }}>workerlar boʻyicha</span>
          </div>
          <BarChart data={vol.data} labels={vol.labels} hotIdx={hotVol} unit=" soʻrov" />
          <div className="faint" style={{ fontSize: 12, marginTop: 6, textAlign: 'center' }}>Ustun ustiga bosing</div>
        </div>
      </div>

      <div className="section-head" style={{ margin: '22px 0 14px' }}>
        <h2>Workerlar boʻyicha</h2>
        <span className="count">{total}</span>
        <div className="sp" />
        <span className="faint" style={{ fontSize: 12 }}>kartani bosing · soʻrovlar tarixi</span>
      </div>
      <div className="wcards">
        {workers.length === 0 && (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <div className="ico"><Server /></div>
            <h3>Worker yoʻq</h3>
            <p>Workerlar boʻlimidan qoʻshing. Holat shu yerda koʻrinadi.</p>
          </div>
        )}
        {workers.map((w) => {
          const r = Math.round(w.successRate * 100)
          const failIdx = w.history.slice(-16).map((h, i) => (h.ok ? -1 : i)).filter((i) => i >= 0)
          const spark = w.history.slice(-16).map((h) => Math.max(2, Math.min(12, h.ms / 40)))
          return (
            <div className="wcard" key={w.workerUrl} onClick={() => openWorker(w)}>
              <div className="p-row">
                <span className={`p-dot ${r >= 90 ? 'd-pos' : r >= 60 ? 'd-warn' : 'd-neg'}`} />
                <b className="mono" style={{ fontSize: 13, flex: 1 }}>{w.label || w.workerUrl}</b>
                <span className={`badge ${r >= 90 ? 'b-pos' : r >= 60 ? 'b-warn' : 'b-neg'}`}>{r >= 90 ? "Sogʻlom" : r >= 60 ? 'Sekin' : "Oʻlik"}</span>
              </div>
              <div className="p-row" style={{ gap: 14, marginTop: 12 }}>
                <div style={{ flex: '0 0 auto' }}>
                  <ArcGauge pct={r} size={110} band={r >= 90 ? 'pos' : r >= 60 ? 'warn' : 'neg'} />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="p-row" style={{ justifyContent: 'space-between' }}>
                    <span className="faint" style={{ fontSize: 11 }}>Soʻrovlar</span>
                    <b className="mono" style={{ fontSize: 13 }}>{w.totalRequests}</b>
                  </div>
                  <div className="p-row" style={{ justifyContent: 'space-between' }}>
                    <span className="faint" style={{ fontSize: 11 }}>Javob</span>
                    <b className="mono" style={{ fontSize: 13 }}>{w.lastResponseTimeMs != null ? `${w.lastResponseTimeMs}ms` : '-'}</b>
                  </div>
                  <Spark values={spark} failIdx={failIdx} px={1.6} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- the view ---------------------------------------------------------------------

type SetTab = 'updates' | 'workers' | 'health'

export function SettingsView() {
  const [tab, setTab] = useState<SetTab>('workers')

  useEffect(() => {
    document.title = 'Sozlamalar · Sud tizimi'
  }, [])

  return (
    <div>
      <div className="hero" style={{ marginBottom: 14 }}>
        <div className="eyebrow">Tizim boshqaruvi</div>
        <h1>Sozlamalar</h1>
        <p>Yangilanishlar, Cloudflare workerlar va tarmoq holatini boshqaring.</p>
      </div>

      <div className="set-tabs">
        <button className={`set-tab ${tab === 'updates' ? 'on' : ''}`} onClick={() => setTab('updates')}>
          <GitBranch />
          Yangilanishlar
        </button>
        <button className={`set-tab ${tab === 'workers' ? 'on' : ''}`} onClick={() => setTab('workers')}>
          <Server />
          Workerlar
        </button>
        <button className={`set-tab ${tab === 'health' ? 'on' : ''}`} onClick={() => setTab('health')}>
          <Activity />
          Holat
        </button>
      </div>

      {tab === 'updates' && <UpdatesTab />}
      {tab === 'workers' && <WorkersTab />}
      {tab === 'health' && <HealthTab />}
    </div>
  )
}
