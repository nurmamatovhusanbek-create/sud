'use client'

/**
 * Shown in place of «Kvitansiyalar yuklanmoqda» when a company has no bills stored here but the Telegram copy holds it: loading from there costs the
 * sites nothing, so the person is asked first. Nothing starts by itself. The passphrase is typed here, used once and not kept.
 */

import { useEffect, useRef, useState } from 'react'
import { DatabaseBackup } from 'lucide-react'
import { useBackup, type CatalogEntry } from '@/hooks/use-backup'
import { formatDmy } from '@/core/dates'

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function TelegramCopyCard({ entry, onScrape, onLoaded }: { entry: CatalogEntry; onScrape: () => void; onLoaded: () => void }) {
  const { snap, running, load } = useBackup()
  const [pass, setPass] = useState('')
  const started = useRef(false)
  const st = snap?.state
  const mine = st?.kind === 'load'

  // the load this card started has finished: the tab reads what it brought
  useEffect(() => {
    if (started.current && mine && st?.phase === 'done') {
      started.current = false
      onLoaded()
    }
  }, [mine, st?.phase, onLoaded])

  const go = async () => {
    started.current = true
    if (await load(pass, [entry.tin])) setPass('')
    else started.current = false
  }

  return (
    <div className="dw-orders-empty" style={{ margin: '12px 0' }}>
      <b>Bu kompaniya Telegram zaxirasida bor.</b>{' '}
      {entry.refreshedAt > 0 ? `Maʼlumot ${formatDmy(new Date(entry.refreshedAt))} holatiga: ` : ''}
      {fmt(entry.bills)} ta kvitansiya{entry.found > 0 ? `, ${fmt(entry.found)} ta topilgan ish` : ''}. Uni shu yerdan yuklash saytlarga hech qanday soʻrov yubormaydi; keyin kerak boʻlsa «Yangilash» bosiladi.
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        <label className="field" style={{ height: 34, width: 240 }}>
          <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Zaxira paroli" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => void go()} disabled={pass.length < 10 || running}>
          {running && mine ? <span className="spinner" /> : <DatabaseBackup />}
          Telegramdan yuklash
        </button>
        <button className="btn btn-outline btn-sm" onClick={onScrape} disabled={running}>Saytdan oʻqish</button>
      </div>
      {mine && st && st.phase !== 'idle' && (
        <div style={{ marginTop: 8, color: st.phase === 'error' ? 'var(--neg-text)' : 'var(--text-2)' }}>{st.message}</div>
      )}
    </div>
  )
}
