'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Check, X, Loader2, Plus, Trash2, FlaskConical, AlertCircle, Copy, FileCode } from 'lucide-react'
import { toast } from 'sonner'

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
  bodyPreview?: string
}

const REASON_LABELS: Record<string, string> = {
  timeout: 'Vaqt tugadi',
  http_502: '502 Bad Gateway',
  http_5xx: 'Server xatosi (5xx)',
  http_4xx: 'Xato so\'rov (4xx)',
  non_json: 'JSON emas',
  html_response: 'HTML sahifa (worker ishlamaydi)',
  wrong_shape: "Noto'g'ri format",
  network_error: 'Tarmoq xatosi',
  not_https: 'HTTPS emas',
}

export function WorkersTab() {
  const [data, setData] = useState<WorkersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [newUrl, setNewUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyingCode, setCopyingCode] = useState(false)

  const fetchWorkers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/workers')
      const json = await res.json()
      setData(json)
    } catch {
      setError("Workerlar ro'yxatini yuklab bo'lmadi")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkers()
  }, [fetchWorkers])

  const handleTest = async (url?: string) => {
    const testUrl = url || newUrl.trim()
    if (!testUrl) return

    setTesting(true)
    setTestResult(null)
    setError(null)

    try {
      const res = await fetch('/api/settings/workers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: testUrl, timeoutMs: 10000 }),
      })
      const result: TestResult = await res.json()
      setTestResult(result)

      // If testing an existing worker, refresh the list to show updated test result
      if (url) {
        setTimeout(() => fetchWorkers(), 500)
      }
    } catch (e: any) {
      setTestResult({
        ok: false,
        reason: 'network_error',
        detail: e.message,
      })
    } finally {
      setTesting(false)
    }
  }

  const handleAdd = async () => {
    if (!newUrl.trim()) return
    setAdding(true)
    setError(null)

    try {
      const res = await fetch('/api/settings/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim() }),
      })
      const result = await res.json()

      if (result.ok) {
        setNewUrl('')
        setTestResult(null)
        await fetchWorkers()
      } else {
        const errorMessages: Record<string, string> = {
          invalid_url: "URL noto'g'ri. HTTPS bo'lishi va path bo'lmasligi kerak",
          duplicate: 'Bu worker allaqachon mavjud',
          missing_url: 'URL kiriting',
        }
        setError(errorMessages[result.error] || 'Xato yuz berdi')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (url: string) => {
    try {
      await fetch(`/api/settings/workers?url=${encodeURIComponent(url)}`, {
        method: 'DELETE',
      })
      await fetchWorkers()
    } catch (e) {
      console.error('Failed to remove worker:', e)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const sourceLabels: Record<string, string> = {
    file: 'workers.json',
    env: '.env',
    fallback: 'Birlamchi',
  }

  // v163: Copy CF Worker code to clipboard
  const handleCopyCode = async () => {
    setCopyingCode(true)
    try {
      const res = await fetch('/api/settings/workers/code')
      const json = await res.json()
      if (json.ok) {
        await navigator.clipboard.writeText(json.code)
        toast.success('Worker kodi nusxalandi!')
      } else {
        toast.error('Kodni o\'qib bo\'lmadi')
      }
    } catch (e) {
      toast.error('Xato: ' + (e instanceof Error ? e.message : 'noma\'lum'))
    } finally {
      setCopyingCode(false)
    }
  }

  return (
    <div className="space-y-4 py-2">
      {/* Source badge + Copy code button */}
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Manba:</span>
          <Badge variant="outline">{sourceLabels[data?.source || 'fallback']}</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyCode}
          disabled={copyingCode}
          className="gap-1.5"
        >
          {copyingCode ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FileCode className="w-3.5 h-3.5" />
          )}
          <span className="text-xs">Kodni nusxalash</span>
        </Button>
      </div>

      {/* Add new worker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Yangi worker qo'shish
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="https://your-worker.workers.dev"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTest()}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTest()}
              disabled={!newUrl.trim() || testing}
              className="gap-1.5"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FlaskConical className="w-3.5 h-3.5" />
              )}
              Sinash
            </Button>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!newUrl.trim() || adding}
              className="gap-1.5"
            >
              {adding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Qo'shish
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted text-sm relative">
              {testResult.ok ? (
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <X className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                {testResult.ok ? (
                  <p className="font-medium">
                    Ishladi — {testResult.caseCount} ta ish qaytardi ({testResult.responseMs}ms)
                  </p>
                ) : (
                  <div>
                    <p className="font-medium">
                      Xato — {REASON_LABELS[testResult.reason || ''] || testResult.reason}
                    </p>
                    {testResult.detail && (
                      <p className="text-xs text-muted-foreground mt-1 break-words">
                        {testResult.detail}
                      </p>
                    )}
                    {testResult.bodyPreview && (
                      <pre className="text-xs mt-1 p-2 bg-background rounded overflow-x-auto max-h-24 overflow-y-auto">
                        {testResult.bodyPreview}
                      </pre>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => setTestResult(null)}
                className="shrink-0 p-1 hover:bg-background rounded transition-colors"
                aria-label="Yopish"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workers list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Workerlar ({data?.workers.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data?.workers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Workerlar yo'q. Yuqoridagi form orqali qo'shing.
            </p>
          ) : (
            data?.workers.map((worker) => (
              <div
                key={worker.url}
                className="flex items-center justify-between gap-2 p-2 rounded-md border"
              >
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono break-all">{worker.url}</code>
                  {worker.lastTestResult && (
                    <div className="flex items-center gap-1 mt-1">
                      {worker.lastTestResult === 'ok' ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                      <span className="text-xs text-muted-foreground">
                        {worker.lastTestDetail || (worker.lastTestResult === 'ok' ? 'Ishladi' : 'Xato')}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => handleTest(worker.url)}
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                  </Button>
                  {/* v163: Delete button always visible (user-added or fallback) */}
                  {worker.addedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(worker.url)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {data?.source !== 'file' && (
        <p className="text-xs text-muted-foreground text-center">
          Workerlar {sourceLabels[data?.source || 'fallback']} dan olingan.
          workers.json faylidan boshqarish uchun yangi worker qo'shing.
        </p>
      )}
    </div>
  )
}
