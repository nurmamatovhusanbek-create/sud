'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react'

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
  lastUsedAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
  deadUntil: string | null
  status: 'alive' | 'dead'
  origins: string[]
  history: RequestRecord[]
}

interface HealthData {
  workers: WorkerHealth[]
  configuredWorkerCount: number
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

type TimeSpan = 'today' | '7d' | '30d' | 'all'

// ---- SVG Chart Components ----

function DonutChart({ successRate, size = 100 }: { successRate: number; size?: number }) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const successLength = successRate * circumference
  const errorLength = circumference - successLength

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="var(--muted)" strokeWidth={stroke}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="var(--foreground)" strokeWidth={stroke}
        strokeDasharray={`${successLength} ${errorLength}`}
        strokeDashoffset={circumference / 4}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text
        x="50%" y="50%"
        textAnchor="middle" dy=".3em"
        className="font-semibold"
        style={{ fontSize: size * 0.18, fill: 'var(--foreground)' }}
      >
        {(successRate * 100).toFixed(0)}%
      </text>
    </svg>
  )
}

function Sparkline({ records, width = 200, height = 40 }: { records: RequestRecord[]; width?: number; height?: number }) {
  if (records.length === 0) {
    return <div style={{ width, height }} className="flex items-center justify-center text-xs text-muted-foreground">—</div>
  }

  // Bucket records into time slots
  const now = Date.now()
  const oldest = Math.min(...records.map(r => r.ts))
  const span = now - oldest || 1
  const buckets = 30
  const bucketSize = span / buckets
  const bucketData: { ok: number; fail: number }[] = Array.from({ length: buckets }, () => ({ ok: 0, fail: 0 }))

  for (const r of records) {
    const idx = Math.min(buckets - 1, Math.floor((r.ts - oldest) / bucketSize))
    if (r.ok) bucketData[idx].ok++
    else bucketData[idx].fail++
  }

  const maxVal = Math.max(1, ...bucketData.map(b => b.ok + b.fail))
  const barWidth = width / buckets

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {bucketData.map((b, i) => {
        const okHeight = (b.ok / maxVal) * (height - 2)
        const failHeight = (b.fail / maxVal) * (height - 2)
        const x = i * barWidth
        return (
          <g key={i}>
            {b.ok > 0 && (
              <rect
                x={x + 1} y={height - okHeight - 1}
                width={barWidth - 2} height={okHeight}
                fill="var(--foreground)" opacity={0.8}
              />
            )}
            {b.fail > 0 && (
              <rect
                x={x + 1} y={height - okHeight - failHeight - 1}
                width={barWidth - 2} height={failHeight}
                fill="var(--muted-foreground)" opacity={0.5}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

function HorizontalBar({ success, fail, width = 120 }: { success: number; fail: number; width?: number }) {
  const total = success + fail
  if (total === 0) return <div style={{ width, height: 6 }} className="rounded-full bg-muted" />
  const successWidth = (success / total) * width
  const failWidth = (fail / total) * width
  return (
    <div className="flex rounded-full overflow-hidden bg-muted" style={{ width, height: 6 }}>
      <div className="bg-foreground transition-all duration-300" style={{ width: successWidth }} />
      <div className="bg-muted-foreground/40 transition-all duration-300" style={{ width: failWidth }} />
    </div>
  )
}

// ---- Main Component ----

export function HealthTab() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [timeSpan, setTimeSpan] = useState<TimeSpan>('all')
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`/api/settings/health?_=${Date.now()}`)
      const json = await res.json()
      setData(json)
    } catch {
      console.error('Failed to fetch health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchHealth, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchHealth])

  // ESC key to collapse expanded worker
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedWorker(null)
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
        <p className="text-sm">Ma'lumot yuklanmadi</p>
      </div>
    )
  }

  const formatRate = (rate: number) => `${(rate * 100).toFixed(1)}%`
  const formatMs = (ms: number | null) => (ms !== null ? `${ms}ms` : '—')
  const formatTime = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    const now = Date.now()
    const diff = Math.floor((now - d.getTime()) / 1000)
    if (diff < 5) return 'hozir'
    if (diff < 60) return `${diff}s`
    if (diff < 3600) return `${Math.floor(diff / 60)}d`
    return d.toLocaleTimeString('uz-UZ')
  }

  // Filter history by time span
  const filterByTimeSpan = (history: RequestRecord[]): RequestRecord[] => {
    if (timeSpan === 'all') return history
    const now = Date.now()
    const cutoff = timeSpan === 'today' ? now - 24 * 3600 * 1000 : timeSpan === '7d' ? now - 7 * 24 * 3600 * 1000 : now - 30 * 24 * 3600 * 1000
    return history.filter(r => r.ts >= cutoff)
  }

  const timeSpans: { value: TimeSpan; label: string }[] = [
    { value: 'today', label: 'Bugun' },
    { value: '7d', label: '7 kun' },
    { value: '30d', label: '30 kun' },
    { value: 'all', label: 'Barcha' },
  ]

  return (
    <div className="py-2 space-y-4">
      {/* Top bar: title + controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Worker statistikasi</h3>
        <div className="flex items-center gap-2">
          {/* Time span picker */}
          <div className="flex border rounded-md overflow-hidden">
            {timeSpans.map(ts => (
              <button
                key={ts.value}
                onClick={() => setTimeSpan(ts.value)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  timeSpan === ts.value
                    ? 'bg-foreground text-background'
                    : 'bg-transparent text-muted-foreground hover:bg-muted'
                }`}
              >
                {ts.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="gap-1.5 h-7 text-xs"
          >
            <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? 'Avto' : 'Off'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchHealth}
            className="gap-1.5 h-7 text-xs"
          >
            <RefreshCw className="w-3 h-3" />
            Yangilash
          </Button>
        </div>
      </div>

      {/* Summary row — 4 stat tiles */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">So'rovlar</p>
          <p className="text-xl font-semibold mt-1">{data.summary.totalRequests}</p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Muvaffaqiyat</p>
          <p className="text-xl font-semibold mt-1">{formatRate(data.summary.overallSuccessRate)}</p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Faol</p>
          <p className="text-xl font-semibold mt-1">{data.summary.activeWorkers}</p>
        </div>
        <div className="border rounded-lg p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Nofaol</p>
          <p className="text-xl font-semibold mt-1">{data.summary.deadWorkers}</p>
        </div>
      </div>

      {/* Donut + Distribution bar side by side */}
      {data.summary.totalRequests > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {/* Donut chart */}
          <div className="border rounded-lg p-4 flex flex-col items-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Muvaffaqiyat nisbati</p>
            <DonutChart successRate={data.summary.overallSuccessRate} size={100} />
            <div className="flex gap-3 mt-2 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-foreground inline-block" />
                {data.summary.totalSuccesses}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />
                {data.summary.totalFailures}
              </span>
            </div>
          </div>

          {/* Distribution bar + legend */}
          <div className="col-span-2 border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">So'rovlar taqsimoti</p>
            <div className="h-3 rounded-full overflow-hidden bg-muted flex mb-3">
              <div
                className="bg-foreground transition-all duration-500"
                style={{ width: `${data.summary.overallSuccessRate * 100}%` }}
              />
              <div
                className="bg-muted-foreground/30 transition-all duration-500"
                style={{ width: `${(1 - data.summary.overallSuccessRate) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-foreground inline-block" />
                <div>
                  <p className="font-medium">{data.summary.totalSuccesses} muvaffaqiyatli</p>
                  <p className="text-muted-foreground">{formatRate(data.summary.overallSuccessRate)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-muted-foreground/30 inline-block" />
                <div>
                  <p className="font-medium">{data.summary.totalFailures} xato</p>
                  <p className="text-muted-foreground">{formatRate(1 - data.summary.overallSuccessRate)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Worker cards — expandable */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Workerlar bo'yicha</p>
        {data.workers.length === 0 ? (
          <div className="border rounded-lg py-8 text-center text-muted-foreground text-sm">
            Hozircha ma'lumot yo'q. So'rovlar amalga oshirilgandan keyin statistika paydo bo'ladi.
          </div>
        ) : (
          data.workers.map((w) => {
            const isExpanded = expandedWorker === w.workerUrl
            const filteredHistory = filterByTimeSpan(w.history || [])
            const recentRequests = [...filteredHistory].reverse().slice(0, 20)

            return (
              <div
                key={w.workerUrl}
                className={`border rounded-lg transition-all duration-300 ${
                  isExpanded ? 'col-span-full shadow-sm' : ''
                }`}
              >
                {/* Collapsed view */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedWorker(isExpanded ? null : w.workerUrl)}
                >
                  {/* Status badge */}
                  <Badge
                    variant={w.status === 'alive' ? 'default' : 'destructive'}
                    className="shrink-0 text-xs"
                  >
                    {w.status === 'alive' ? 'Faol' : 'Nofaol'}
                  </Badge>

                  {/* Worker name */}
                  <div className="flex-1 min-w-0">
                    <code className="text-xs font-mono truncate block">{w.label}</code>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{w.totalRequests} so'rov</span>
                      <span>·</span>
                      <span>{formatRate(w.successRate)}</span>
                      {w.lastResponseTimeMs !== null && (
                        <>
                          <span>·</span>
                          <span>{formatMs(w.lastResponseTimeMs)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Mini sparkline */}
                  <div className="hidden sm:block shrink-0">
                    <Sparkline records={filteredHistory} width={120} height={24} />
                  </div>

                  {/* Horizontal bar */}
                  <div className="hidden md:block shrink-0">
                    <HorizontalBar success={w.totalSuccesses} fail={w.totalFailures} width={80} />
                  </div>

                  {/* Expand/collapse icon */}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </div>

                {/* Expanded view — vertical details */}
                {isExpanded && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-4">
                    {/* Stats row */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Jami so'rov</p>
                        <p className="font-medium text-sm mt-0.5">{w.totalRequests}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Muvaffaqiyat</p>
                        <p className="font-medium text-sm mt-0.5">{w.totalSuccesses} ({formatRate(w.successRate)})</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Xato</p>
                        <p className="font-medium text-sm mt-0.5">{w.totalFailures}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Oxirgi javob</p>
                        <p className="font-medium text-sm mt-0.5">{formatMs(w.lastResponseTimeMs)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Oxirgi ishlatilgan</p>
                        <p className="font-medium text-sm mt-0.5">{formatTime(w.lastUsedAt)}</p>
                      </div>
                    </div>

                    {/* Large sparkline chart */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">So'rovlar vaqt bo'yicha ({timeSpans.find(t => t.value === timeSpan)?.label})</p>
                      <Sparkline records={filteredHistory} width={600} height={60} />
                    </div>

                    {/* Recent requests timeline */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Oxirgi so'rovlar ({recentRequests.length})</p>
                      {recentRequests.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Bu davrda so'rovlar yo'q</p>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {recentRequests.map((r, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-muted/50">
                              {r.ok ? (
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                              ) : (
                                <XCircle className="w-3 h-3 shrink-0" />
                              )}
                              <span className="text-muted-foreground shrink-0">
                                {new Date(r.ts).toLocaleTimeString('uz-UZ')}
                              </span>
                              <span className="text-muted-foreground shrink-0">{r.ms}ms</span>
                              <code className="font-mono text-muted-foreground truncate">{r.origin}</code>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Failure reason */}
                    {w.lastFailureReason && (
                      <div className="flex items-start gap-2 p-2 rounded bg-muted text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                        <div className="min-w-0">
                          <span className="text-muted-foreground">Oxirgi xato sababi: </span>
                          <code className="font-mono break-all">{w.lastFailureReason}</code>
                        </div>
                      </div>
                    )}

                    {/* Origins */}
                    <div className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Manbalar:</span>
                      <div className="flex flex-wrap gap-1">
                        {w.origins.map(o => (
                          <Badge key={o} variant="outline" className="text-xs font-mono">
                            {o}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Full URL */}
                    <div className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">URL:</span>
                      <code className="font-mono break-all text-muted-foreground">{w.workerUrl}</code>
                    </div>

                    {/* Collapse button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedWorker(null)}
                      className="gap-1.5 h-7 text-xs"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      Yopish (Esc)
                    </Button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Last updated */}
      <p className="text-xs text-muted-foreground text-right">
        Oxirgi yangilanish: {formatTime(data.fetchedAt)}
      </p>
    </div>
  )
}
