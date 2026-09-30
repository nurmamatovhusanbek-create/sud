'use client'

/**
 * The Kuzatuv page's orders control: one button, a quiet status line and the opt-in idle switch.
 *
 * Nothing here scrapes by itself. «What needs checking» is worked out from the cases each watched company already has
 * cached (a local, free call — see planWatchlistOrders) and shown as a count on the button; the run only starts when
 * the button is pressed. While a run is going the same button pauses it, and a paused queue is continued from here.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { FileText, Pause, Play } from 'lucide-react'
import { pausePublicOrdersJob, resumePublicOrdersJob } from '@/lib/api-client'
import { autoEnabled, checkWatchlistOrders, pauseWatchlistCheck, planWatchlistOrders, resumeWatchlistCheck, runnerSnapshot, setAutoEnabled, subscribeRunner } from '@/lib/orders-watchlist'
import { useOrdersJob } from '@/lib/use-orders-job'

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function OrdersControl({ companies, registryVersion }: { companies: number; registryVersion: number }) {
  const { job } = useOrdersJob()
  const runner = useSyncExternalStore(subscribeRunner, runnerSnapshot, runnerSnapshot)
  const [auto, setAuto] = useState(false)
  const [pending, setPending] = useState<number | null>(null)

  useEffect(() => setAuto(autoEnabled()), [])

  // how many cases would really need a look — refreshed when the cached cases change or a run ends, never on a timer
  const jobState = job?.state
  useEffect(() => {
    if (companies === 0) {
      setPending(0)
      return
    }
    let stop = false
    const t = setTimeout(() => {
      void planWatchlistOrders().then((p) => {
        if (!stop) setPending(p ? p.need : null)
      })
    }, 800)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [companies, registryVersion, jobState])

  const collecting = runner.phase === 'collecting'
  const running = job?.state === 'running'
  const paused = job?.state === 'paused'
  const remaining = job?.remaining ?? 0

  let status = ''
  if (collecting) status = `Ishlar yigʻilmoqda · ${runner.done}/${runner.total} kompaniya${runner.paused ? ' · pauza' : ''}`
  else if (paused) status = `Pauzada · ${num(remaining)} ta ish qoldi`
  else if (running) status = `Tekshirilmoqda · ${job!.done}/${job!.total} ish`
  else if (pending) status = `${num(pending)} ta ish tekshirilishi kerak`

  const onClick = () => {
    if (collecting) return void (runner.paused ? resumeWatchlistCheck() : pauseWatchlistCheck())
    if (running) return void pausePublicOrdersJob()
    if (paused) return void resumePublicOrdersJob()
    void checkWatchlistOrders({ auto: false })
  }
  const label = collecting ? (runner.paused ? 'Davom ettirish' : 'Pauza') : running ? 'Pauza' : paused ? 'Davom ettirish' : 'Qarorlarni tekshirish'
  const Icon = collecting ? (runner.paused ? Play : Pause) : running ? Pause : paused ? Play : FileText

  return (
    <>
      {status && <span className="faint" style={{ fontSize: 12 }}>{status}</span>}
      <label
        className="faint"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}
        title="Yoqilsa, ilova 3 daqiqa ishlatilmaganda kuzatuvdagi kompaniyalar qarorlarini oʻzi tekshiradi. Oʻchiq boʻlsa hech narsa oʻzi boshlanmaydi."
      >
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked)
            setAutoEnabled(e.target.checked)
          }}
        />
        Boʻsh vaqtda avto
      </label>
      <button
        className="btn btn-outline btn-sm"
        disabled={companies === 0}
        title="Kuzatuvdagi kompaniyalar ishlarining eʼlon qilingan qarorlarini fonda yuklash"
        onClick={onClick}
      >
        <Icon />
        <span>{label}</span>
      </button>
    </>
  )
}
