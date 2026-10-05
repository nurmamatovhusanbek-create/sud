'use client'

/**
 * Context bar — the prototypeʼs company identity strip: 52px monogram tile,
 * name + status dot + grouped STIR with copy, and the action cluster (rating
 * badge, refresh / export circle buttons, the watch pill button).
 */

import { useEffect, useState } from 'react'
import { Copy, Download, FileText, RefreshCw, Star } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/lib/store/app-store'
import { companyStatusFamily, ratingBandFamily } from '@/core/status'
import { isWatched, setWatched } from '@/lib/registry'
import { openCompanyReport } from '@/lib/report/generate'
import { useRegistryVersion } from '@/lib/use-registry'
import { toast } from 'sonner'
import { ageLabel } from '@/core/age'
import { useDataAge } from '@/lib/data-age'
import { hardRefreshWithToast, useRefreshing } from '@/lib/hard-refresh'
import { familyDotClass, familyBadgeClass, grp, initials } from '@/components/proto/primitives'
import { bandFromFamily } from '@/components/proto/primitives'

const PART_LABEL: Record<string, string> = {
  stats: 'Statistika',
  info: 'Profil',
  bills: 'Toʻlovlar',
  'court:economic': 'Iqtisodiy sud',
  'court:civil': 'Fuqarolik sud',
  'court:administrative': 'Maʼmuriy sud',
}

const statusLabel = (s?: string) => {
  if (!s) return ''
  const v = s.toLowerCase()
  if (v.includes('фаол') || v.includes('faol') || v.includes('active') || v.includes('мавжуд') || v.includes('mavjud')) return 'Faoliyatda'
  if (v.includes('тўхтатилган') || v.includes("to'xtatilgan") || v.includes('suspended')) return "Toʻxtatilgan"
  if (v.includes('тугатилган') || v.includes('tugatilgan') || v.includes('liquidat')) return 'Tugatilgan'
  return s
}

export function ContextBar() {
  const company = useAppStore((s) => s.activeCompany)
  const [copied, setCopied] = useState(false)
  const rv = useRegistryVersion()
  const watching = company ? (rv >= 0 ? isWatched(company.stir) : false) : false
  const refreshing = useRefreshing(company?.stir)
  const age = useDataAge(company?.stir)
  // the label ages while the page stays open
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!company) return null

  const statusFamily = companyStatusFamily(company.status)
  const ratingFamily = company.rating?.category ? ratingBandFamily(company.rating.category) : null

  const copyStir = async () => {
    try {
      await navigator.clipboard.writeText(company.stir)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
      toast.success('STIR nusxalandi')
    } catch {
      toast.error('Nusxalab boʻlmadi')
    }
  }

  const toggleWatch = () => {
    const next = !watching
    setWatched(company.stir, company.name, next)
    toast.success(next ? 'Kuzatuvga qoʻshildi' : 'Kuzatuvdan olindi', {
      description: company.name || `STIR ${company.stir}`,
    })
  }

  const refresh = () => void hardRefreshWithToast(company.stir)
  const exportx = () => window.dispatchEvent(new CustomEvent('sud:export-active'))

  return (
    <div className="ctxbar">
      <div className="mono-tile">
        {company.name ? initials(company.name) : grp(company.stir).slice(0, 2)}
      </div>
      <div className="ctx-name">
        <h1 className="nm">{company.name || `STIR ${grp(company.stir)}`}</h1>
        <div className="sub">
          {company.status && (
            <>
              <span className={`p-dot ${familyDotClass(statusFamily)}`} />
              {statusLabel(company.status)}
              <span>·</span>
            </>
          )}
          <span className="mono">STIR {grp(company.stir)}</span>
          <button className="copy" data-copy onClick={() => void copyStir()} aria-label="STIRni nusxalash">
            <Copy style={{ opacity: copied ? 1 : undefined }} />
          </button>
          {age.oldest !== null && !refreshing && (
            <>
              <span>·</span>
              <span
                className="data-age"
                data-stale={age.stale || undefined}
                title={Object.entries(age.parts).map(([k, t]) => `${PART_LABEL[k] ?? k}: ${ageLabel(t, now)}`).join('\n')}
              >
                Yangilandi {ageLabel(age.oldest, now)}{age.stale ? ' · eskirgan' : ''}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="ctx-actions">
        {company.rating?.category && (
          <span className={`badge ${familyBadgeClass(bandFromFamily(ratingFamily ?? 'neutral'))}`}>
            Reyting {company.rating.category}
          </span>
        )}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="circ" data-act="refresh" onClick={refresh} disabled={refreshing} aria-busy={refreshing} aria-label="Toʻliq yangilash (R)">
                <RefreshCw className={refreshing ? 'spin' : undefined} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Toʻliq yangilash (R): saytlardan yangidan oladi</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="circ" data-act="export" onClick={exportx} aria-label="Eksport (E)">
                <Download />
              </button>
            </TooltipTrigger>
            <TooltipContent>Eksport (E)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* the company dossier as a PDF. Kept a text button (not another icon) so it is discoverable. */}
        <button className="btn btn-outline btn-sm" data-act="report" onClick={() => void openCompanyReport(company.stir)} title="Kompaniya hisoboti (PDF)">
          <FileText />
          <span>Hisobot</span>
        </button>
        <button className={`btn ${watching ? 'btn-primary' : 'btn-outline'} btn-sm`} data-act="watch" onClick={toggleWatch}>
          <Star />
          <span>{watching ? 'Kuzatuvda' : 'Kuzatish'}</span>
        </button>
      </div>
    </div>
  )
}
