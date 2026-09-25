'use client'

/**
 * Profile section — the prototypeʼs Profil: data strips (Manzil/Direktor,
 * Roʻyxat/Kapital/Telefon/Email/OKED), quick-action buttons, and the Chamber
 * rating card with the arc gauge, category badge and founders list.
 */

import { useEffect } from 'react'
import { Building2, CalendarDays, Factory, Mail, Phone, Receipt, Gavel, User, Wallet, Star } from 'lucide-react'
import { EmptyBlock, ArcGauge, SkRows, initials } from '@/components/proto/primitives'
import { ScrapeProgress, SCRAPE_CFG } from '@/components/proto/scrape-progress'
import { PartialBanner } from '@/components/ui-custom/states'
import { useResource } from '@/hooks/use-resource'
import { getCompanyInfo } from '@/lib/api-client'
import { useAppStore } from '@/lib/store/app-store'
import { ratingBandFamily } from '@/core/status'
import type { CompanyInfoData } from '@/lib/api-types'
import type { ResourceState } from '@/hooks/use-resource'
import { bandFromFamily } from '@/components/proto/primitives'

export function ProfileSection() {
  const company = useAppStore((s) => s.activeCompany)
  const patchCompany = useAppStore((s) => s.patchCompany)
  const setSection = useAppStore((s) => s.setSection)
  const { state, elapsed, refetch } = useResource<CompanyInfoData>(
    (signal) => getCompanyInfo(company?.stir || '', { signal }),
    {
      cacheKey: company ? `company-info:${company.stir}` : undefined,
      enabled: !!company,
    },
  )

  // v208: Yangilash previously did NOTHING on this section (no listener).
  useEffect(() => {
    const handler = () => void refetch()
    window.addEventListener('sud:force-section', handler)
    return () => window.removeEventListener('sud:force-section', handler)
  }, [refetch])

  // Hydrate identity into the active company (context bar fills instantly)
  useEffect(() => {
    if (state.status === 'success' || state.status === 'partial') {
      const c = state.data.company
      if (c?.shortName || c?.officialName) patchCompany({ name: c.shortName || c.officialName })
      if (c?.status) patchCompany({ status: c.status })
      if (state.data.rating?.category) {
        patchCompany({
          rating: {
            category: state.data.rating.category,
            score: typeof state.data.rating.score === 'number' ? (state.data.rating.score as number) : null,
          },
        })
      }
    }
  }, [state.status, patchCompany])

  if (!company) return null
  const view = state as ResourceState<CompanyInfoData>

  // v18: scrape progress card on first load (skeleton only for in-place refreshes)
  if (view.status === 'idle' || view.status === 'loading')
    return <ScrapeProgress {...SCRAPE_CFG.profile} elapsed={elapsed} />
  if (view.status === 'error')
    return (
      <EmptyBlock
        icon={<Building2 />}
        title="Profil olinmadi"
        hint={view.error}
        action={
          <button className="btn btn-outline btn-sm" onClick={() => void refetch()}>
            Qayta urinish
          </button>
        }
      />
    )
  if (view.status === 'empty')
    return <EmptyBlock icon={<Building2 />} title="Profil topilmadi" hint="orginfo.uz va chamber.uz da bu STIR boʻyicha maʼlumot yoʻq." />

  const c = view.data.company
  const rating = view.data.rating
  const founders = (c?.founders as { name?: string; share?: string }[] | undefined) || []
  const score = typeof rating?.score === 'number' ? Math.min(100, rating.score) : null
  const ratingFamily = rating?.category ? ratingBandFamily(rating.category) : null
  const ratingBand = bandFromFamily(ratingFamily ?? 'neutral')

  const quick = [
    { key: 'bills', label: "Toʻlovlar", icon: <Receipt /> },
    { key: 'cases', label: 'Sud ishlari', icon: <Gavel /> },
    { key: 'hearings', label: 'Majlislar', icon: <CalendarDays /> },
  ] as const

  return (
    <div>
      {view.status === 'partial' && <PartialBanner errors={view.partialErrors} onRetry={() => void refetch()} />}
      <div className="dash" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <div className="rise-c">
          <div className="dstrip" style={{ marginBottom: 16 }}>
            <div className="dfield">
              <div className="k"><Building2 />Manzil</div>
              <div className="v">{c?.address || '-'}</div>
            </div>
            <div className="dfield">
              <div className="k"><User />Direktor</div>
              <div className="v">{c?.director || '-'}</div>
            </div>
          </div>

          <div className="dstrip" style={{ marginBottom: 16 }}>
            <div className="dfield">
              <div className="k"><CalendarDays />Roʻyxatdan oʻtgan</div>
              <div className="v mono">{c?.registeredDate || '-'}</div>
            </div>
            <div className="dfield">
              <div className="k"><Wallet />Ustav kapitali</div>
              <div className="v mono">{c?.charterCapital || '-'}</div>
            </div>
            <div className="dfield">
              <div className="k"><Phone />Telefon</div>
              <div className="v mono">{c?.phone || '-'}</div>
            </div>
            <div className="dfield">
              <div className="k"><Mail />Email</div>
              <div className="v mono">{c?.email || '-'}</div>
            </div>
            <div className="dfield" style={{ minWidth: '100%' }}>
              <div className="k"><Factory />OKED faoliyat turi</div>
              <div className="v">
                {rating?.okedCode ? `${rating.okedCode} · ` : ''}
                {rating?.okedName || c?.ifut || '-'}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Tezkor amallar</div>
            <div className="p-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {quick.map((q) => (
                <button key={q.key} className="btn btn-outline btn-sm" onClick={() => setSection(q.key)}>
                  {q.icon}
                  <span>{q.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Star /></div>
            <h3>Chamber reytingi</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            {score !== null ? (
              <ArcGauge pct={score} size={160} band={ratingBand} label="Ishonch balli (0–100)" id="profile-score" />
            ) : (
              <ArcGauge pct={0} size={160} band="neu" label="Ball mavjud emas" />
            )}
            {rating?.category ? (
              <span
                className={`badge ${ratingBand === 'pos' ? 'b-pos' : ratingBand === 'warn' ? 'b-warn' : ratingBand === 'neg' ? 'b-neg' : 'b-neu'}`}
                style={{ height: 28, fontSize: 13 }}
              >
                Kategoriya {rating.category}
              </span>
            ) : (
              <span className="badge b-neu" style={{ height: 28, fontSize: 13 }}>Kategoriya yoʻq</span>
            )}
            <div className="faint" style={{ fontSize: 12 }}>{c?.thsht || '-'}</div>
            <div className="faint" style={{ fontSize: 11 }}>admin.chamber.uz · Pudratchi reytingi</div>
          </div>

          {founders.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Taʼsischilar</div>
              {founders.map((f, i) => (
                <div className="founder" key={i}>
                  <div className="av">{initials(f.name || '-')}</div>
                  <b style={{ flex: 1, fontSize: 13 }}>{f.name || '-'}</b>
                  <span className="mono faint">{f.share || '-'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
