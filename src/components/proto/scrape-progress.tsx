'use client'

/**
 * ScrapeProgress — the v18 progress card for the NON-stream tabs
 * (Statistika, Sud ishlari, Majlislar, Kompaniya). Replaces the blank
 * skeleton as the first-load state: phase ladder + bar + honest elapsed
 * timer (no fabricated record counts — the stream tabs keep their real
 * NDJSON counts).
 *
 * Driven by useResource({ elapsed }): phases advance on elapsed thresholds
 * paced to a ~12s full-scrape budget and stay honest (they never claim
 * completion). prefers-reduced-motion: static first phase, no animation.
 */

const EXPECTED_MS = 12_000

export interface ScrapeCfg {
  title: string
  phases: string[]
}

export function ScrapeProgress({ title, phases, elapsed }: ScrapeCfg & { elapsed: number | null }) {
  const ms = elapsed ?? 0
  const step = Math.min(phases.length - 1, Math.floor(ms / (EXPECTED_MS / phases.length)))
  const pct = Math.min(96, 4 + Math.round((ms / EXPECTED_MS) * 88))
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  return (
    <div className="scrape" role="status" aria-live="polite">
      <div className="stream">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              display: 'grid',
              placeItems: 'center',
              flex: 'none',
            }}
          >
            <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
            </svg>
          </span>
          <div>
            <b style={{ fontSize: 14 }}>{title}…</b>
            <div className="faint mono" style={{ fontSize: 12 }}>
              {(ms / 1000).toFixed(1)}s · manbalar ketma-ket soʻralmoqda
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <span className="spinner" />
        </div>
        <div className="stream-bar">
          <div className="stream-fill" style={{ width: `${pct}%`, transition: reduced ? 'none' : undefined }} />
        </div>
        <div className="phases">
          {phases.map((p, i) => (
            <div className={`phase ${i < step ? 'done' : i === step ? 'active' : ''}`} key={p}>
              <span className="pd">
                {i < step ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                )}
              </span>
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Per-tab phase copy (prototype SCR map, fed by real source names). */
export const SCRAPE_CFG: Record<string, ScrapeCfg> = {
  overview: {
    title: 'Statistika yigʻilmoqda',
    phases: [
      'sud.uz manbalariga ulanilmoqda',
      'PoW captcha yechilmoqda (SHA-256)',
      'Ishlar roʻyxati olinmoqda',
      'Har bir ish tafsiloti boyitilmoqda',
    ],
  },
  cases: {
    title: 'Sud ishlari olinmoqda',
    phases: [
      'my.sud.uz ga ulanilmoqda',
      'PoW captcha yechilmoqda',
      'Ishlar boʻyicha qidiruv',
      'Qarshi tomon va holat boyitilmoqda',
    ],
  },
  hearings: {
    title: 'Majlislar jadvali olinmoqda',
    phases: ['e-sud.uz ga ulanilmoqda', 'Majlislar kalendari olinmoqda', 'Sudya va zal maʼlumoti'],
  },
  profile: {
    title: 'Kompaniya profili olinmoqda',
    phases: [
      'orginfo.uz ga ulanilmoqda',
      'Roʻyxatdan oʻtish maʼlumoti',
      'chamber.uz reytingi olinmoqda',
      'Reyting hisoblanmoqda',
    ],
  },
}
