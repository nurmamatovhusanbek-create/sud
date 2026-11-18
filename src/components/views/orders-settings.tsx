'use client'

/**
 * Settings › Qarorlar — what the local orders cache holds and where it lives (it is never deleted: only added to and updated),
 * and where its protected second copy is. The searchable list of the stored orders is its own page (views/orders-view.tsx).
 * (The automatic / background checking of the Kuzatuv companies and its queue controls were removed: public.sud.uz refuses
 * scripts, so they could not work; orders come in through the HAR import and the case drawer's own check.)
 */

import { useCallback, useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import { getPublicOrdersCache } from '@/lib/api-client'
import type { OrdersCacheStats } from '@/lib/public-orders/types'

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const p2 = (n: number) => String(n).padStart(2, '0')
const dmyHm = (t: number | string | null): string => {
  if (!t) return '–'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '–' : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

export function OrdersTab() {
  const [cache, setCache] = useState<OrdersCacheStats | null>(null)
  const loadCache = useCallback(async () => {
    const c = await getPublicOrdersCache()
    if (c.ok) setCache(c.data)
  }, [])
  useEffect(() => {
    void loadCache()
  }, [loadCache])

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Database /></div>
          <h2>Mahalliy kesh</h2>
        </div>
        {cache ? (
          <>
            <div className="kv"><span className="k">Tekshirilgan ishlar</span><span className="mono">{num(cache.cases)}</span></div>
            <div className="kv"><span className="k">Qarori eʼlon qilingan ishlar</span><span className="mono">{num(cache.withOrders)}</span></div>
            <div className="kv"><span className="k">Saqlangan qarorlar</span><span className="mono">{num(cache.orders)}</span></div>
            {cache.failed > 0 && <div className="kv"><span className="k">Tekshirib boʻlmagan (qayta uriniladi)</span><span className="mono">{num(cache.failed)}</span></div>}
            <div className="kv"><span className="k">Diskda</span><span className="mono">{size(cache.bytes)}</span></div>
            <div className="kv"><span className="k">Oxirgi tekshiruv</span><span className="mono">{dmyHm(cache.lastCheckedAt)}</span></div>
          </>
        ) : (
          <p className="faint" style={{ fontSize: 12.5, margin: '2px 0 0' }}>Yuklanmoqda…</p>
        )}
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '10px 0 10px' }}>
          Faqat qaror haqidagi kichik yozuvlar saqlanadi (ish raqami, instansiya, sud, sudya, natija, PDF havolasi). Qaror matni faqat PDF ni bosganingizda olinadi va shundan keyin diskda saqlanadi (sidebar dagi “Qarorlar” sahifasida “Yuklangan” deb koʻrinadi).
          Kesh hech qachon oʻchirilmaydi: faqat yangi yozuvlar qoʻshiladi va oʻzgargan ishlar yangilanadi, chunki uni qayta yigʻish uzoq davom etadi.
        </p>
        {cache && <div className="kv"><span className="k">Saqlanadigan joy</span><span className="mono" style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{cache.dir}</span></div>}
        {cache && (
          <>
            <div className="kv">
              <span className="k">Himoyalangan zaxira nusxa</span>
              <span className="mono" style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{cache.backup ? cache.backup.dir : 'oʻchiq'}</span>
            </div>
            {cache.backup && (
              <div className="kv">
                <span className="k">Oxirgi nusxa</span>
                <span className="mono">{cache.backup.files ? `${dmyHm(cache.backup.lastAt)} · ${cache.backup.files} fayl · ${cache.backup.days} kunlik` : 'hali olinmagan (bir necha soniyada olinadi)'}</span>
              </div>
            )}
            {cache.restored && (
              <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '8px 0 0', color: 'var(--text-2)' }}>
                Oxirgi ishga tushirishda oʻchirilgan qarorlar maʼlumotlari zaxira nusxadan avtomatik tiklandi ({cache.restored.files} fayl, {dmyHm(cache.restored.at)}). Yuklab olingan PDF fayllar “Qarorlar” sahifasida “Mavjud emas” deb koʻrinadi va “Qayta yuklash” bilan qaytariladi.
              </p>
            )}
            <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '8px 0 0' }}>
              Qarorlar maʼlumotlarining (roʻyxat, tekshiruvlar, yuklab olish tarixi) ikkinchi nusxasi oddiy papkangizdan boshqa, kam ochiladigan joyda saqlanadi va har oʻzgarishdan keyin yangilanadi.
              Asosiy papka tasodifan oʻchirilsa, ilova keyingi ishga tushganda uni oʻzi tiklaydi (PDF fayllar nusxalanmaydi: ularni qayta yuklab olish mumkin). Maʼlumotlarni butunlay tozalamoqchi boʻlsangiz, ikkala papkani ham oʻchiring.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
