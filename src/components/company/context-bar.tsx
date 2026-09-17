'use client'

/**
 * Context bar — the prototypeʼs company identity strip: 52px monogram tile,
 * name + status dot + grouped STIR with copy, and the action cluster (rating
 * badge, refresh / export circle buttons, the watch pill button).
 */

import { useState } from 'react'
import { Copy, Download, RefreshCw, Star } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/lib/store/app-store'
import { companyStatusFamily, ratingBandFamily } from '@/core/status'
import { isWatched, setWatched } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { toast } from 'sonner'
import { familyDotClass, familyBadgeClass, grp, initials } from '@/components/proto/primitives'
import { bandFromFamily } from '@/components/proto/primitives'

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

  const refresh = () => {
    toast('Ma’lumot yangilanmoqda…')
    window.dispatchEvent(new CustomEvent('sud:force-section'))
  }
  const exportx = () => window.dispatchEvent(new CustomEvent('sud:export-active'))

  return (
    <div className="ctxbar">
      <div className="mono-tile" style={{ width: 52, height: 52, borderRadius: 15, fontSize: 18 }}>
        {company.name ? initials(company.name) : grp(company.stir).slice(0, 2)}
      </div>
      <div className="ctx-name">
        <div className="nm">{company.name || `STIR ${grp(company.stir)}`}</div>
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
              <button className="circ" data-act="refresh" onClick={refresh} aria-label="Yangilash (R)">
                <RefreshCw />
              </button>
            </TooltipTrigger>
            <TooltipContent>Yangilash (R)</TooltipContent>
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
        <button className={`btn ${watching ? 'btn-primary' : 'btn-outline'} btn-sm`} data-act="watch" onClick={toggleWatch}>
          <Star />
          <span>{watching ? 'Kuzatuvda' : 'Kuzatish'}</span>
        </button>
      </div>
    </div>
  )
}
