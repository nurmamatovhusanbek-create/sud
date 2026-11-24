'use client'

/**
 * Under the cases list of a company whose court list is cut at the court's row limit (or that already has bills): the cases the bills
 * name and the list lacks. Everything is started by a click; the work runs on the server and this panel WATCHES it (the list grows live
 * as cases are found, and the job goes on if the page is left). The same button continues where the last run stopped.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useBillJob } from '@/hooks/use-bill-cases'
import { formatDmy } from '@/core/dates'

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function BillCasesPanel({ stir, capped }: { stir: string; capped: boolean }) {
  const { state, running, start, stop } = useBillJob(stir)
  const [now, setNow] = useState(() => Date.now())
  const [startErr, setStartErr] = useState<string | null>(null)
  const job = state?.job
  const st = state?.status

  // the countdown of a back-off
  useEffect(() => {
    if (!job?.waitingUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job?.waitingUntil])

  const go = async (opts: { load: 'auto' | 'refresh' | 'skip'; fill: boolean; refresh?: 'open' }) => {
    setStartErr(null)
    const err = await start(opts)
    if (err) {
      setStartErr(err) // in the panel too: a toast in the corner is easy to miss, and «nothing happens» was the report
      toast.error(err, { position: 'top-left' })
    }
  }

  if (!state) return null
  const loaded = !!st && st.totalBills > 0 && st.loaded
  if (!capped && !running && !(st && st.billCases > 0) && !loaded) return null

  const paused = job?.state === 'paused'
  const failed = job?.state === 'error'
  const wait = job?.waitingUntil ? Math.max(0, Math.ceil((job.waitingUntil - now) / 1000)) : 0

  let text: string
  if (running && job?.phase === 'load') {
    text = `Toʻlovlar oʻqilmoqda: ${job.page}/${job.pages || '…'}-sahifa${job.pass > 0 ? ` · ${job.pass + 1}-oʻtish` : ''}${job.bills ? ` · ${fmt(job.bills)} ta kvitansiya` : ''}. Oʻqilgan sahifalardagi ishlar roʻyxatga keyin qoʻshiladi.`
  } else if (running && job?.phase === 'fill') {
    text = `Ishlar raqam boʻyicha olinmoqda: ${fmt(job.done)}/${fmt(job.total)} · ${fmt(job.found)} tasi topildi${job.absent ? `, ${fmt(job.absent)} tasi sud tizimida yoʻq` : ''}. Topilgan ishlar roʻyxatga shu zahoti qoʻshiladi; sahifadan chiqsangiz ham davom etadi.`
  } else if (running && job?.phase === 'refresh') {
    text = `Tugallanmagan ishlar yangilanmoqda: ${fmt(job.done)}/${fmt(job.total)} · ${fmt(job.changed)} tasida oʻzgarish bor. Tugagan ishlar qayta soʻralmaydi; sahifadan chiqsangiz ham davom etadi.`
  } else if (job?.state === 'done' && job.kind === 'refresh') {
    text = job.total === 0
      ? 'Yangilanadigan ish yoʻq: topilgan ishlarning hammasi tugagan yoki oxirgi 6 soatda olingan.'
      : `Tugallanmagan ishlar yangilandi: ${fmt(job.done)} ta soʻraldi, ${fmt(job.changed)} tasida oʻzgarish bor${job.absent ? `, ${fmt(job.absent)} tasi sud tizimida topilmadi` : ''}.`
  } else if (job?.state === 'done' && job.kind === 'fill' && job.total === 0) {
    text = 'Olinadigan ish yoʻq: toʻlovlarda nomlangan hamma ishlar allaqachon olingan yoki soʻralgan.'
  } else if (!loaded || !st || st.billCases === 0) {
    text = 'Sud tizimi bu STIR boʻyicha roʻyxatni cheklaydi (yangi tizim 100 ta, eski tizim 200 ta qator): eski ishlar koʻrinmasligi mumkin. Bir marta koʻrilgan ish serverda saqlanadi va roʻyxatdan yoʻqolmaydi. Toʻlovlar (billing.sud.uz) har bir ishning raqamini beradi (har ishga odatda ikkita kvitansiya: davlat boji va pochta xarajati): yetishmayotgan ishlarni shu raqamlar orqali olish mumkin.'
  } else {
    text = `Toʻlovlarda ${fmt(st.billCases)} ta ish raqami bor: ${fmt(st.found)} tasi olingan, ${fmt(st.missing)} tasi hali olinmagan${st.notFound > 0 ? `, ${fmt(st.notFound)} tasi sud tizimida topilmadi` : ''}.`
  }

  // the base of every refresh: when the first scrape began and the data's «as of» (nothing refreshes by itself)
  const dayMs = 86_400_000
  const ageDays = st && st.refreshedAt > 0 ? Math.max(0, Math.floor((now - st.refreshedAt) / dayMs)) : null
  const dates =
    st && st.firstAt > 0
      ? `Birinchi yuklash: ${formatDmy(new Date(st.firstAt))} · ${
          st.refreshedAt > 0 ? `maʼlumot ${formatDmy(new Date(st.refreshedAt))} holatiga (${ageDays === 0 ? 'bugun' : `${ageDays} kun oldin`})${st.lastAdded > 0 ? `, oxirgi yuklashda ${fmt(st.lastAdded)} ta kvitansiya qoʻshilgan` : ''}` : 'toʻlovlar hali toʻliq oʻqilmagan'
        }`
      : null

  return (
    <div className="dw-orders-empty" style={{ marginBottom: 10 }}>
      {text}
      {dates && <div style={{ marginTop: 6, color: 'var(--text-2)', fontSize: 12.5 }}>{dates}</div>}
      {st && st.passes.length > 0 && (
        <div style={{ marginTop: 4, color: 'var(--text-2)', fontSize: 12.5 }}>
          Oʻtishlar: {st.passes.map((p) => `${p.pass + 1}-oʻtish +${fmt(p.added)}`).join(' · ')}
          {st.coverage !== null ? ` · taxminiy qamrov ${Math.round(st.coverage * 1000) / 10}%` : ''}
        </div>
      )}
      {st && st.passes.length > 0 && st.passes[st.passes.length - 1]!.links && (() => {
        const l = st.passes[st.passes.length - 1]!.links!
        return (
          <div style={{ marginTop: 4, color: 'var(--text-2)', fontSize: 12.5 }}>
            {st.keepsAll ? 'Ish raqamisiz kvitansiyalar ham saqlanadi (Toʻlovlar tabida koʻrinadi, zaxiraga kirmaydi; oxirgi oʻtishda)' : 'Ish raqamisiz kvitansiyalar saqlanmaydi (oxirgi oʻtishda)'}: {fmt(l.claimCost)} tasi daʼvo xarajati (pochta, video, sud toʻlovlari: ish hali ochilmagan), {fmt(l.unlinked)} tasi boshqa
            {l.text > 0 ? `; ${fmt(l.text)} tasida ish raqami tavsifdan olindi` : ''}.
          </div>
        )
      })()}
      {wait > 0 && <div style={{ marginTop: 6, color: 'var(--text-2)' }}>Sud tizimi javob bermadi: {wait} soniyadan keyin qayta uriniladi ({job?.lastError}).</div>}
      {startErr && <div style={{ marginTop: 6, color: 'var(--neg-text)' }}>{startErr}</div>}
      {(paused || failed) && job?.lastError && <div style={{ marginTop: 6, color: 'var(--neg-text)' }}>{job.lastError}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {running ? (
          <button className="btn btn-outline btn-sm" onClick={() => void stop()}>Toʻxtatish</button>
        ) : !loaded || !st || st.billCases === 0 ? (
          <button className="btn btn-outline btn-sm" onClick={() => void go({ load: 'auto', fill: true })}>
            {st && st.totalBills > 0 && !st.loaded ? 'Toʻlovlarni oʻqishni davom ettirish' : 'Toʻlovlardan ishlarni topish'}
          </button>
        ) : (
          <>
            {st.missing > 0 && (
              <button className="btn btn-outline btn-sm" onClick={() => void go({ load: 'skip', fill: true })}>
                {paused || job?.state === 'stopped' ? 'Davom ettirish' : 'Yetishmayotgan ishlarni olish'} ({fmt(st.missing)})
              </button>
            )}
            {st.found > 0 && (
              <button className="btn btn-outline btn-sm" onClick={() => void go({ load: 'skip', fill: false, refresh: 'open' })}>Tugallanmagan ishlarni yangilash</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => void go({ load: 'refresh', fill: true })}>Toʻlovlarni yangilash</button>
          </>
        )}
      </div>
    </div>
  )
}
