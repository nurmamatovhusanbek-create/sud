'use client'

/**
 * Prototype primitives — the Sud Signal signature visuals ported 1:1 from
 * sud-prototype.html: hairline dial gauge, bar chart with hover
 * tooltip, sparkline, count-up numbers, KPI card, segmented control.
 * All colors flow through the semantic tokens (color = signal only).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import { dateParts, DateTile, daysLabel, isNear } from './date-tile'
import { motionReduced } from '@/lib/motion'
import { countAt, countDuration } from '@/lib/count-tween'
import { thumbVars, useThumb } from '@/lib/use-thumb'
import { StatusIcon, type StatusFamilyKey } from '@/components/ui-custom/solid-icons'
import type { StatusFamily } from '@/core/status'
import { ratingBandFamily } from '@/core/status'
import { clampPct, type DialZones } from './dial-geometry'

export type Band = 'pos' | 'neg' | 'warn' | 'info' | 'neu'

export function bandOf(value: number): Band {
  return value >= 60 ? 'pos' : value >= 40 ? 'warn' : 'neg'
}

/** Map a StatusFamily to the prototype band letters. */
export function bandFromFamily(f: StatusFamily | string): Band {
  switch (f) {
    case 'positive': return 'pos'
    case 'negative': return 'neg'
    case 'warning': return 'warn'
    case 'info': return 'info'
    default: return 'neu'
  }
}

const BAND_VAR: Record<Band, string> = {
  pos: 'var(--pos-base)',
  neg: 'var(--neg-base)',
  warn: 'var(--warn-base)',
  info: 'var(--info-base)',
  neu: 'var(--accent)',
}

export function familyDotClass(f: StatusFamily | string): string {
  switch (f) {
    case 'positive': return 'd-pos'
    case 'negative': return 'd-neg'
    case 'warning': return 'd-warn'
    case 'info': return 'd-info'
    default: return 'd-neu'
  }
}

export function familyBadgeClass(f: StatusFamily | string): string {
  switch (f) {
    case 'positive': return 'b-pos'
    case 'negative': return 'b-neg'
    case 'warning': return 'b-warn'
    case 'info': return 'b-info'
    default: return 'b-neu'
  }
}

/** True after first client paint — drives the mount animations. */
export function useMounted(): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setM(true)))
    return () => cancelAnimationFrame(raf)
  }, [])
  return m
}


/** Count-up number (eased, 750ms) — matches prototype countUp(). */
// Remember the last value each keyed counter reached, so a REMOUNT (e.g. the
// stats view re-keys on refresh, or you re-enter the tab) doesn't replay the
// count-up from zero. Same id + same value → no animation; a changed value
// animates from the previous one, not 0. Unkeyed counters behave as before.
const countCache = new Map<string, number>()

export function CountUp({ value, suffix = '', className, id }: { value: number; suffix?: string; className?: string; id?: string }) {
  const skip = motionReduced() || !Number.isFinite(value)
  const seed = id != null && countCache.has(id) ? (countCache.get(id) as number) : Math.min(value, 0)
  const [display, setDisplay] = useState(skip ? value : seed)
  // the value on screen RIGHT NOW (unrounded). A retarget in the middle of a count (invoices arriving one by one: 1, 2, 3, 4, 5)
  // continues from here instead of from where the cancelled count started: that was the «1-2-1-2-3-1-2-3-4» restart.
  const fromRef = useRef(seed)
  useEffect(() => {
    if (id != null) countCache.set(id, value) // remember the target across remounts
    if (skip) { fromRef.current = value; return }
    const from = fromRef.current
    if (from === value) return // already there — no replay
    const dur = countDuration(value - from)
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const v = p >= 1 ? value : countAt(from, value, p)
      fromRef.current = v
      setDisplay(Math.round(v))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, skip, id])
  if (skip) {
    return (
      <span className={className}>
        {value}
        {suffix}
      </span>
    )
  }
  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  )
}

/**
 * Dial — a score as a NUMBER over a RULER of hairline ticks that light up to the value (an instrument, not a pie or a ring). The figure
 * counts up once on mount and glides to a new value; lit ticks are ink, the rest a quiet step. `zones` mark their limits with taller
 * ticks (workers 60 / 90, health 80) and, on big instances, print them under the ruler: no colour band, the number is the signal.
 * `pct = null` draws an empty bar with «–». Same props as the old gauge, so every call site keeps working.
 */
/** worker success rate: < 60 dead · 60–89 slow · ≥ 90 healthy (the badges and dots use the same limits) */
export const WORKER_ZONES: DialZones = [[60, 'neg'], [90, 'warn'], [100, 'pos']]
/** overall success rate: ≥ 80 healthy */
export const HEALTH_ZONES: DialZones = [[80, 'warn'], [100, 'pos']]

const dialSeen = new Map<string, number>() // keyed dials remember where they were, so a remount doesn't replay from 0

export function Dial({
  pct,
  size,
  zones = null,
  label,
  unit = '',
  id,
}: {
  pct: number | null
  size: number
  /** kept for call-site compatibility; the score is no longer coloured by a band */
  band?: Band
  zones?: DialZones | null
  label?: string
  unit?: string
  id?: string
}) {
  const target = pct === null ? 0 : clampPct(pct)
  const start = id != null && dialSeen.has(id) ? (dialSeen.get(id) as number) : 0
  const [shown, setShown] = useState(start)
  const fromRef = useRef(start)
  useEffect(() => {
    if (id != null) dialSeen.set(id, target)
    const from = fromRef.current
    if (from === target) return
    if (motionReduced()) { fromRef.current = target; setShown(target); return }
    const dur = from === 0 ? 1300 : 800
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const v = from + (target - from) * (1 - Math.pow(1 - p, 4))
      fromRef.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, id])

  const big = size > 150
  const n = big ? 50 : 24 // ticks on the ruler: one every 2 (or ~4) points
  const limits = (zones ?? []).map(([v]) => v).filter((v) => v < 100)
  const limitTick = new Set(limits.map((v) => Math.round((v / 100) * n)))
  const lit = (shown / 100) * n
  return (
    <div
      className={`score${big ? ' score-big' : ''}`}
      style={{ width: size }}
      role="img"
      aria-label={pct === null ? (label ?? 'Maʼlumot yoʻq') : `${label ? `${label}: ` : ''}${Math.round(target)}${unit}`}
    >
      {label && big ? <div className="score-l">{label}</div> : null}
      <div className="score-n mono" aria-hidden>
        {pct === null ? '–' : Math.round(shown)}
        {unit && pct !== null ? <small>{unit}</small> : null}
      </div>
      <div className="ruler" aria-hidden>
        {Array.from({ length: n + 1 }, (_, i) => (
          <i key={i} className={`${pct !== null && i < lit ? 'on' : ''}${limitTick.has(i) ? ' lim' : i % 5 === 0 ? ' maj' : ''}`} />
        ))}
      </div>
      {big ? (
        <div className="score-scale mono" aria-hidden>
          <span style={{ left: '0%' }}>0</span>
          {limits.map((v) => (
            <span key={v} style={{ left: `${v}%` }}>{v}</span>
          ))}
          <span style={{ left: '100%' }}>100</span>
        </div>
      ) : null}
    </div>
  )
}

/** Vertical bar chart with hover tooltip + hot column — prototype barChart(). */
export function BarChart({
  data,
  labels,
  hotIdx,
  unit = '',
  onBarClick,
}: {
  data: number[]
  labels: string[]
  hotIdx?: number
  unit?: string
  onBarClick?: (index: number, value: number, label: string) => void
}) {
  const mounted = useMounted()
  const maxT = Math.max(...data, 1)
  const [tip, setTip] = useState<{ x: number; on: boolean; label: string; v: number }>({ x: 0, on: false, label: '', v: 0 })
  const chartRef = useRef<HTMLDivElement>(null)
  return (
    <div className="chart" ref={chartRef}>
      <div className="bars">
        {data.map((n, i) => (
          <div
            key={i}
            className={`bar-col ${i === hotIdx ? 'hot' : ''}`}
            onMouseEnter={(e) => {
              const col = e.currentTarget.getBoundingClientRect()
              const chart = chartRef.current?.getBoundingClientRect()
              if (!chart) return
              setTip({ x: col.left - chart.left + col.width / 2, on: true, label: labels[i], v: n })
            }}
            onMouseLeave={() => setTip((t) => ({ ...t, on: false }))}
            onClick={() => onBarClick?.(i, n, labels[i])}
          >
            <div className="bar-track">
              <div className="bar" style={{ height: mounted ? `${Math.round((n / maxT) * 100)}%` : '0%', ['--i' as string]: i }} />
            </div>
            <div className="bar-lbl">{labels[i]}</div>
          </div>
        ))}
      </div>
      <div className={`tip ${tip.on ? 'on' : ''}`} style={{ left: tip.x, top: 0 }}>
        <b>{tip.label}</b> · {tip.v}
        {unit}
      </div>
    </div>
  )
}

/** Tiny sparkline — prototype .spark. */
export function Spark({ values, failIdx = [], px = 2.2 }: { values: number[]; failIdx?: number[]; px?: number }) {
  const mounted = useMounted()
  return (
    <div className="spark">
      {values.map((n, i) => (
        <i key={i} className={failIdx.includes(i) ? 'f' : ''} style={{ height: mounted ? `${n * px}px` : '0px' }} />
      ))}
    </div>
  )
}

/** KPI tile: a label, one figure and what it compares to. The icon is a large corner watermark that says what the tile counts (Premium look; hidden in the navy look). */
export function Kpi({
  label,
  icon,
  children,
  foot,
  valueSize,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
  foot?: React.ReactNode
  valueSize?: number
}) {
  return (
    <div className="kpi">
      {icon ? <div className="kpi-ico" aria-hidden="true">{icon}</div> : null}
      <div className="kpi-top">
        <div className="lbl">{label}</div>
      </div>
      <div className="val" style={valueSize ? { fontSize: valueSize } : undefined}>
        {children}
      </div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  )
}

/** Segmented control — prototype .seg. */
export function Seg({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { thumb, ready } = useThumb(ref, [value, options])
  return (
    <div className={`seg${thumb ? ' has-thumb' : ''}${ready ? ' thumb-ready' : ''}`} ref={ref}>
      {thumb && <span className="thumb" style={thumbVars(thumb)} />}
      {options.map((o) => (
        <button key={o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Two-option pill toggle — prototype .toggle-pair. */
export function TogglePair({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="toggle-pair">
      {options.map((o) => (
        <button key={o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Empty state block — prototype .empty. */
export function EmptyBlock({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">{icon}</div>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  )
}

/** Skeleton rows shaped like .lrow — prototype skRows(). */
export function SkRows({ n = 5 }: { n?: number }) {
  return (
    <div className="list">
      {Array.from({ length: n }, (_, i) => (
        <div className="lrow" key={i} style={{ cursor: 'default' }}>
          <div className="sk" style={{ width: 40, height: 40, borderRadius: 11 }} />
          <div style={{ flex: 1 }}>
            <div className="sk" style={{ width: '42%', height: 12, marginBottom: 7 }} />
            <div className="sk" style={{ width: '70%', height: 9 }} />
          </div>
          <div className="sk" style={{ width: 70, height: 22, borderRadius: 99 }} />
        </div>
      ))}
    </div>
  )
}

/** Skeleton KPI grid — prototype skKpis(). */
export function SkKpis({ n = 4 }: { n?: number }) {
  return (
    <div className="kpis">
      {Array.from({ length: n }, (_, i) => (
        <div className="kpi" key={i}>
          <div className="sk" style={{ width: '50%', height: 10, marginBottom: 14 }} />
          <div className="sk" style={{ width: '60%', height: 24 }} />
        </div>
      ))}
    </div>
  )
}

/** Grouped STIR "302 678 824" */
export function grp(s: string | number | null | undefined): string {
  const v = String(s ?? '')
  return v.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
}

/** Monogram initials — prototype initials(), hardened for live orginfo names:
 *  strips quote/punctuation wrappers per word ("ARTIKUL → A) before taking
 *  the first letters, so the tile never renders a `"` glyph. */
export function initials(name: string): string {
  const out = name
    .split(' ')
    .map((w) => w.replace(/^[^A-Za-zА-Яа-яЎўҚқҒғҲҳ]+/, ''))
    .filter((w) => /[A-Za-zА-Яа-яЎўҚқҒғҲҳ]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return out || '··'
}

/**
 * Company-card stats body (Option C): a full-width divider, then two columns —
 * Reyting (score + a band-colored rating letter pill) and Keyingi majlis (day +
 * month, with an amber "N kun qoldi" sub line when ≤7 days; "Majlis yoʻq" when
 * there is no upcoming hearing). Shared by the launcher and watchlist cards so
 * they never drift. Score/rating come from meta.score / meta.rating; the date
 * from meta.nextHearingIso.
 */
export function CardStats({
  score,
  rating,
  hearingIso,
}: {
  score?: number | null
  rating?: string | null
  hearingIso?: string | null
}) {
  // a hearing that has passed is not «keyingi»: a cached list outlives its dates (core/dates › stillAhead)
  const hearing = dateParts(hearingIso)
  const upcoming = hearing && hearing.days !== null && hearing.days >= 0 ? hearing : null
  return (
    <>
      <div className="cc-div" />
      <div className="cc-cols">
        <div className="cc-col">
          <div className="k">Reyting</div>
          <div className="v">
            <span className="num">{score != null ? <CountUp value={score} /> : '—'}</span>
            {rating ? <span className={`lt ${familyBadgeClass(ratingBandFamily(rating) ?? 'neutral')}`}>{rating}</span> : null}
          </div>
        </div>
        <div className="cc-col">
          <div className="k">Keyingi majlis</div>
          {upcoming ? (
            <div className="cc-when">
              <DateTile iso={hearingIso} size="sm" />
              <div className="cc-when-t">
                <div className={`cc-left${isNear(upcoming.days) ? ' near' : ''}`}>{daysLabel(upcoming.days)}</div>
                <div className="cc-wd">{upcoming.weekday}</div>
              </div>
            </div>
          ) : (
            <div className="v">
              <span className="none">Majlis yoʻq</span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ==== outcome bars (the distribution chart) + win-rate meter ==================

import {
  pizzaCounts,
  pizzaTotal,
  PIZZA_STATUS_LABEL,
  PIZZA_STATUS_ORDER,
  type PizzaItem,
  type PizzaStatus,
} from '@/components/proto/pizza-geometry'
import { winRate } from '@/core/rates'

/**
 * OutcomeBoard — the case distribution, built to be read in one glance (no pie, no legend to decode).
 *   HERO   the answer for the selected slice (or all cases): a huge win rate, ONE thick strip of every case (won solid ·
 *          lost tint · neutral hatched · in progress dashed outline) and four stat columns under it that are the legend AND
 *          the numbers (icon, count, share), so a one-pixel segment is never the only place a figure lives.
 *   TILES  one per slice (court type / category), each with its own composition drawn to 100 % so slices compare by SHAPE;
 *          picking a tile re-aims the hero, picking it again goes back to «all».
 * Everything is ONE ink: the premium look has no hue, so contrast, density and the status icon carry the meaning.
 * Controlled like the old pizza: `selected` is an index into `items` (-1 = all), `onSelect` reports a tile.
 */
const OUTCOME_FAMILY: Record<PizzaStatus, StatusFamilyKey> = { won: 'win', lost: 'lose', neutral: 'neutral', pending: 'pending' }

function OutcomeStrip({ counts, total, size }: { counts: Record<PizzaStatus, number>; total: number; size: 'lg' | 'sm' }) {
  return (
    <span className={`ob-strip ${size}`} style={{ ['--sw' as string]: 'var(--text-1)' }} aria-hidden="true">
      {total === 0 ? <i className="empty" /> : null}
      {PIZZA_STATUS_ORDER.map((st) => (counts[st] > 0 ? <i key={st} className={`st ${st}`} style={{ flexGrow: counts[st] }} /> : null))}
    </span>
  )
}

export function OutcomeBoard({
  items,
  selected = -1,
  onSelect,
  kind,
  tilesLabel,
  action,
}: {
  items: PizzaItem[]
  selected?: number
  onSelect?: (item: PizzaItem, index: number) => void
  /** e.g. «Sud turi» — names the slice kind in the hero */
  kind: string
  tilesLabel: string
  action?: React.ReactNode
}) {
  const sel = selected >= 0 && selected < items.length ? items[selected] : null
  const all = useMemo<PizzaItem>(
    () => ({
      label: 'Barchasi',
      full: 'Barcha ishlar',
      col: '',
      pill: '',
      won: items.reduce((n, it) => n + it.won, 0),
      lost: items.reduce((n, it) => n + it.lost, 0),
      neutral: items.reduce((n, it) => n + (it.neutral ?? 0), 0),
      pending: items.reduce((n, it) => n + (it.pending ?? 0), 0),
    }),
    [items],
  )
  const subject = sel ?? all
  const counts = pizzaCounts(subject)
  const total = pizzaTotal(subject)
  const decided = subject.won + subject.lost
  const wr = winRate(subject.won, subject.lost) // the ONE app-wide definition: won ÷ (won + lost)

  return (
    <div className="ob2">
      <div className="ob2-hero">
        <div className="ob2-head">
          {sel ? <span className="ob2-kind">{kind}</span> : null}
          <b className="ob2-name">{subject.full}</b>
          <span className="ob2-total mono">{total} ish</span>
          <span style={{ flex: 1 }} />
          {action}
        </div>
        <div className="ob2-fig">
          <div className="ob2-win">
            <div className="ob2-pct mono">
              {wr === null ? '–' : <CountUp value={wr} id={`ob-wr-${subject.id ?? subject.label}`} />}
              {wr === null ? null : <small>%</small>}
            </div>
            <div className="ob2-cap">
              {wr === null ? 'Hal qilingan ish yoʻq' : `Yutuq darajasi · ${decided} ta hal qilingan ishdan ${subject.won} tasi`}
            </div>
          </div>
          <div className="ob2-main">
            <OutcomeStrip key={subject.id ?? subject.label} counts={counts} total={total} size="lg" />
            <div className="ob2-stats">
              {PIZZA_STATUS_ORDER.map((st) => (
                <div key={st} className={`ob2-stat${counts[st] === 0 ? ' zero' : ''}`} style={{ ['--sw' as string]: 'var(--text-1)' }}>
                  <div className="ob2-stat-h">
                    <StatusIcon family={OUTCOME_FAMILY[st]} size={14} />
                    <span>{PIZZA_STATUS_LABEL[st]}</span>
                    <i className={`st ${st} ob2-sw`} />
                  </div>
                  <div className="ob2-stat-n mono">
                    <CountUp value={counts[st]} />
                    <small>{total ? `${Math.round((counts[st] / total) * 100)}%` : ''}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="ob2-tiles-h">{tilesLabel}</div>
      <div className="ob2-tiles">
        {items.map((it, i) => {
          const c = pizzaCounts(it)
          const t = pizzaTotal(it)
          const r = winRate(it.won, it.lost)
          return (
            <button
              type="button"
              key={it.id ?? it.label}
              className={`ob2-tile${selected === i ? ' on' : ''}`}
              aria-pressed={selected === i}
              onClick={() => onSelect?.(it, i)}
            >
              <span className="ob2-tile-h">
                <span className="ob2-tile-name">{it.label}</span>
                <span className="ob2-tile-n mono"><CountUp value={t} /></span>
              </span>
              <OutcomeStrip counts={c} total={t} size="sm" />
              <span className="ob2-tile-f">
                <span>Yutuq</span>
                <b className="mono">{r === null ? '–' : `${r}%`}</b>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- list sorting (Toʻlovlar · Sud ishlari · Majlislar …) --------------------
//
// One shared sort control + a non-mutating sorter, reused by every list section
// so the modes read identically everywhere: avval yangi / eski, A–Z / Z–A.

export type SortKey = 'new' | 'old' | 'az' | 'za'

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'new', label: 'Avval yangi' },
  { key: 'old', label: 'Avval eski' },
  { key: 'az', label: 'A–Z' },
  { key: 'za', label: 'Z–A' },
]

/** Parse dd.mm.yyyy · yyyy-mm-dd · epoch-ms into a comparable number (0 = unknown). */
export function parseSortDate(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (!v) return 0
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s) // yyyy-mm-dd
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3])
  m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/.exec(s) // dd.mm.yyyy
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1])
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : t
}

// Plain alphabetical (by letter) — A–Z / Z–A order strictly by character,
// not numerically, so the letter order is exactly what the label promises.
const sortCollator = new Intl.Collator('uz', { sensitivity: 'base' })

/** Return a NEW array sorted by the chosen mode. `getDate` → epoch ms, `getText` → label. */
export function applySort<T>(
  list: T[],
  sort: SortKey,
  getDate: (t: T) => number,
  getText: (t: T) => string,
): T[] {
  const arr = [...list]
  switch (sort) {
    case 'new':
      arr.sort((a, b) => getDate(b) - getDate(a))
      break
    case 'old':
      arr.sort((a, b) => getDate(a) - getDate(b))
      break
    case 'az':
      arr.sort((a, b) => sortCollator.compare(getText(a), getText(b)))
      break
    case 'za':
      arr.sort((a, b) => sortCollator.compare(getText(b), getText(a)))
      break
  }
  return arr
}

/** Compact sort picker for the filter bar. */
export function SortMenu({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  return (
    <label className="sortsel" title="Tartiblash">
      <ArrowDownUp />
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)} aria-label="Tartiblash">
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
