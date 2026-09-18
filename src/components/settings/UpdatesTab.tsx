'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, Download, GitBranch, Loader2, AlertCircle, RefreshCw } from 'lucide-react'

interface VersionInfo {
  local: { version: string; sha: string | null; branch: string | null; dirty: boolean; gitAvailable: boolean }
  remote: { sha: string; message: string; author: string; date: string; commitUrl: string } | null
  updateAvailable: boolean
  rateLimited: boolean
  retryAfterSec: number | null
  cachedAt: string | null
}

export function UpdatesTab() {
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null)

  const fetchVersion = useCallback(async () => {
    setLoading(true)
    try {
      // v166: force=1 bypasses server-side cache so we always get fresh data
      const res = await fetch(`/api/settings/version?force=1&_=${Date.now()}`)
      const data = await res.json()
      setInfo(data)
    } catch (e) {
      console.error('Failed to fetch version:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVersion()
  }, [fetchVersion])

  const handleUpdate = async () => {
    setUpdating(true)
    setUpdateResult(null)
    try {
      const res = await fetch('/api/settings/update', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setUpdateResult({
          ok: true,
          message: 'Yangilash muvaffaqiyatli!',
          detail: data.output,
        })
        // Refresh version info
        setTimeout(() => fetchVersion(), 1000)
      } else {
        const errorMessages: Record<string, string> = {
          dirty_tree: "Kodda o'zgarishlar bor. Avval commit qiling yoki stash qiling.",
          wrong_branch: `Faqat main branchida yangilash mumkin. Hozirgi: ${data.currentBranch}`,
          git_unavailable: "Git mavjud emas. Qo'lda yangilang.",
          pull_failed: 'Git pull xatosi.',
        }
        setUpdateResult({
          ok: false,
          message: errorMessages[data.error] || "Noma'lum xato",
          detail: data.detail || data.stderr || '',
        })
      }
    } catch (e: any) {
      setUpdateResult({
        ok: false,
        message: 'Yangilash amalga oshmadi',
        detail: e.message,
      })
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!info) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
        Ma'lumot yuklanmadi
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      {/* Current Version */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Joriy versiya
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Versiya:</span>
            <Badge variant="secondary">{info.local.version}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Git SHA:</span>
            <code className="text-xs font-mono">{info.local.sha || 'N/A'}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Branch:</span>
            <span className="text-xs">{info.local.branch || 'N/A'}</span>
          </div>
          {info.local.dirty && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Holat:</span>
              <Badge variant="outline">O'zgarishlar bor</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remote Version */}
      {info.rateLimited ? (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">
            <AlertCircle className="w-5 h-5 mx-auto mb-2" />
            GitHub so'rovlari cheklangan
            {info.retryAfterSec && (
              <div className="mt-1 text-xs">
                {Math.ceil(info.retryAfterSec / 60)} daqiqadan keyin urinib ko'ring
              </div>
            )}
          </CardContent>
        </Card>
      ) : info.remote ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">GitHub'dagi so'nggi versiya</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">SHA:</span>
              <code className="text-xs font-mono">{info.remote.sha}</code>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Commit:</span>
              <span className="text-xs text-right truncate">{info.remote.message}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Muallif:</span>
              <span className="text-xs">{info.remote.author}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sana:</span>
              <span className="text-xs">
                {new Date(info.remote.date).toLocaleString('uz-UZ')}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Update Status */}
      {info.updateAvailable && !updateResult && (
        <Card className="border-2">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Download className="w-5 h-5" />
              <span className="font-medium">Yangi versiya mavjud!</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {info.local.sha} → {info.remote?.sha}
            </p>
            <Button
              onClick={handleUpdate}
              disabled={updating}
              className="w-full gap-2"
            >
              {updating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Yangilanmoqda...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Yangilash
                </>
              )}
            </Button>
            {info.local.dirty && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Ogohlantirish: lokal o'zgarishlar bor — yangilash paytida stash qilinadi
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Update Result */}
      {updateResult && (
        <Card className={updateResult.ok ? 'border-2' : 'border-2 border-destructive'}>
          <CardContent className="py-4">
            <div className="flex items-start gap-2">
              {updateResult.ok ? (
                <Check className="w-5 h-5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-medium text-sm">{updateResult.message}</p>
                {updateResult.detail && (
                  <pre className="text-xs mt-2 p-2 bg-muted rounded overflow-x-auto max-h-32 overflow-y-auto">
                    {updateResult.detail}
                  </pre>
                )}
                {updateResult.ok && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Iltimos, <code className="font-mono">bun run dev</code> ni qayta ishga tushiring.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Up to date */}
      {!info.updateAvailable && !info.rateLimited && info.local.gitAvailable && (
        <Card>
          <CardContent className="py-6 text-center">
            <Check className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Eng so'nggi versiya</p>
            <p className="text-xs text-muted-foreground mt-1">
              Yangilanishlar yo'q
            </p>
          </CardContent>
        </Card>
      )}

      {/* Manual refresh */}
      <Button variant="ghost" size="sm" onClick={fetchVersion} className="w-full gap-2">
        <RefreshCw className="w-3.5 h-3.5" />
        Qayta tekshirish
      </Button>
    </div>
  )
}
