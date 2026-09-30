'use client'

/**
 * Prototype primitives — the Sud Signal signature visuals ported 1:1 from
 * sud-prototype.html: segmented ring gauge, arc gauge, bar chart with hover
 * tooltip, sparkline, count-up numbers, KPI card, segmented control.
 * All colors flow through the semantic tokens (color = signal only).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import type { StatusFamily } from '@/core/status'
import { ratingBandFamily } from '@/core/status'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

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

const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Count-up number (eased, 750ms) — matches prototype countUp(). */
// Remember the last value each keyed counter reached, so a REMOUNT (e.g. the
// stats view re-keys on refresh, or you re-enter the tab) doesn't replay the
// count-up from zero. Same id + same value → no animation; a changed value
// animates from the previous one, not 0. Unkeyed counters behave as before.
const countCache = new Map<string, number>()

export function CountUp({ value, suffix = '', className, id }: { value: number; suffix?: string; className?: string; id?: string }) {
  const skip = REDUCED || !Number.isFinite(value)
  const seed = id != null && countCache.has(id) ? (countCache.get(id) as number) : Math.min(value, 0)
  const [display, setDisplay] = useState(skip ? value : seed)
  const fromRef = useRef(seed)
  useEffect(() => {
    if (id != null) countCache.set(id, value) // remember the target across remounts
    if (skip) return
    const from = fromRef.current
    if (from === value) { fromRef.current = value; return } // already there — no replay
    const dur = 750
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = value
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

/** Segmented ring gauge (28 dashes) with count-up center — prototype ring(). */
export function Ring({ pct, size, band = 'neu' }: { pct: number; size: number; band?: Band }) {
  const mounted = useMounted()
  const r = (size - 9) / 2
  const c = 2 * Math.PI * r
  const N = 28
  const gap = 3.2
  const dash = c / N - gap
  const active = Math.round((N * Math.min(100, Math.max(0, pct))) / 100)
  const col = BAND_VAR[band]
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: `0 0 ${size}px` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {Array.from({ length: N }, (_, i) => (
            <circle
              key={i}
              className={mounted ? 'gseg gseg-shown' : 'gseg'}
              style={mounted ? { transitionDelay: `${i * 20}ms` } : undefined}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={i < active ? col : 'var(--border-default)'}
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-(i / N) * c}
            />
          ))}
        </g>
      </svg>
      <div
        className="mono"
        style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size * 0.22 }}
      >
        <CountUp value={pct} suffix="%" />
      </div>
    </div>
  )
}

/** Semi-circular dash gauge — prototype arcGauge(). */
export function ArcGauge({ pct, size, band = 'neu', label, id }: { pct: number; size: number; band?: Band; label?: string; id?: string }) {
  const mounted = useMounted()
  const N = 22
  const cx = size / 2
  const cy = size * 0.56
  const R = size * 0.4
  const inr = R - size * 0.11
  const col = BAND_VAR[band]
  const active = Math.round((N * Math.min(100, Math.max(0, pct))) / 100)
  const segs = Array.from({ length: N }, (_, i) => {
    const a = Math.PI * (1 - i / (N - 1))
    return {
      x1: cx + inr * Math.cos(a),
      y1: cy - inr * Math.sin(a),
      x2: cx + R * Math.cos(a),
      y2: cy - R * Math.sin(a),
    }
  })
  return (
    <div className="gauge-wrap" style={{ width: size }}>
      <svg width={size} height={size * 0.66} viewBox={`0 0 ${size} ${size * 0.66}`}>
        {segs.map((s, i) => (
          <line
            key={i}
            className={mounted ? 'gseg gseg-shown' : 'gseg'}
            style={mounted ? { transitionDelay: `${i * 20}ms` } : undefined}
            x1={s.x1.toFixed(1)}
            y1={s.y1.toFixed(1)}
            x2={s.x2.toFixed(1)}
            y2={s.y2.toFixed(1)}
            stroke={i < active ? col : 'var(--border-default)'}
            strokeWidth={size * 0.05}
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div style={{ textAlign: 'center', marginTop: -size * 0.2 }}>
        <div className="mono" style={{ fontSize: size * 0.17, fontWeight: 700, letterSpacing: '-.02em' }}>
          <CountUp value={pct} suffix="%" id={id} />
        </div>
        {label ? <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{label}</div> : null}
      </div>
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
              <div className="bar" style={{ height: mounted ? `${Math.round((n / maxT) * 100)}%` : '0%' }} />
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

/** KPI card — prototype .kpi (+ .ink variant). */
export function Kpi({
  label,
  icon,
  ink,
  children,
  foot,
  valueSize,
}: {
  label: string
  icon?: React.ReactNode
  ink?: boolean
  children: React.ReactNode
  foot?: React.ReactNode
  valueSize?: number
}) {
  return (
    <div className={`kpi ${ink ? 'ink' : ''}`}>
      <div className="kpi-top">
        <div className="lbl">{label}</div>
        {icon ? <div className="kpi-ico">{icon}</div> : null}
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
  const [thumb, setThumb] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const active = root.querySelector<HTMLButtonElement>('button.on')
      if (!active) return setThumb(null)
      setThumb({ left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [value, options])
  return (
    <div className={`seg${thumb ? ' has-thumb' : ''}`} ref={ref}>
      {thumb && <span className="thumb" style={{ left: thumb.left, top: thumb.top, width: thumb.width, height: thumb.height }} />}
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
  const hearing = (() => {
    if (!hearingIso) return null
    const [y, m, d] = hearingIso.split('-').map(Number)
    if (!y || !m || !d) return null
    const days = Math.ceil((new Date(y, m - 1, d).getTime() - Date.now()) / 86_400_000)
    return { d: String(d).padStart(2, '0'), mo: MONTHS[m - 1] ?? '', days }
  })()
  return (
    <>
      <div className="cc-div" />
      <div className="cc-cols">
        <div className="cc-col">
          <div className="k">Reyting</div>
          <div className="v">
            <span className="num">{score != null ? score : '—'}</span>
            {rating ? <span className={`lt ${familyBadgeClass(ratingBandFamily(rating) ?? 'neutral')}`}>{rating}</span> : null}
          </div>
        </div>
        <div className="cc-col">
          <div className="k">Keyingi majlis</div>
          {hearing ? (
            <>
              <div className="v">
                <span className="num">{hearing.d}</span>
                <span className="mo">{hearing.mo}</span>
              </div>
              {hearing.days >= 0 ? (
                <div className={`days${hearing.days <= 7 ? ' warn' : ''}`}>{hearing.days} kun qoldi</div>
              ) : null}
            </>
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

// ==== v18 additions — interactive pizza chart + win-rate ring ==================

import {
  pizzaCounts,
  pizzaModel,
  pizzaTotal,
  winRing as winRingGeom,
  PIZZA_GEOM,
  PIZZA_PAINT,
  PIZZA_STATUS_LABEL,
  PIZZA_STATUS_ORDER,
  type PizzaItem,
  type PizzaStatus,
} from '@/components/proto/pizza-geometry'
import { winRate } from '@/core/rates'

/** SVG paint for one status band, in the slice's hue — density (not hue) carries the status. */
function bandPaint(status: PizzaStatus, col: string, hatch: string) {
  switch (status) {
    case 'won':
      return { fill: col, stroke: 'var(--surface)', strokeWidth: 0.8 }
    case 'lost':
      return { fill: col, fillOpacity: 0.34, stroke: 'var(--surface)', strokeWidth: 0.8 }
    case 'neutral':
      return { fill: hatch, stroke: 'var(--surface)', strokeWidth: 0.8 }
    default:
      return {
        fill: col,
        fillOpacity: PIZZA_PAINT.pending.fillOpacity,
        stroke: col,
        strokeWidth: PIZZA_PAINT.pending.strokeWidth,
        strokeDasharray: PIZZA_PAINT.pending.dash,
      }
  }
}

/**
 * Pizza — radial stack. Each wedge = one slice (court type or category); its radius
 * is the slice's own 100%, stacked from the hub: yutgan, yutqazgan, neytral, jarayonda
 * (solid · tint · hatch · dashed, all in the slice's hue). Total in a pill just outside,
 * navy dotted seams part the slices.
 *
 * Controlled: `selected` (index, or -1 for "nothing selected") is owned by the
 * parent. With nothing selected every slice shows crisp (good for a share/
 * screenshot); once a slice is picked it pops forward while the rest recede and
 * blur (pure CSS via .has-sel). Clicking a slice reports its index; the parent
 * decides selection (and toggles it off when the same slice is clicked again).
 */
export function Pizza({
  items,
  onSelect,
  selected = -1,
  size = 340,
}: {
  items: PizzaItem[]
  onSelect?: (item: PizzaItem, index: number) => void
  selected?: number
  size?: number
}) {
  const model = useMemo(() => pizzaModel(items), [items])
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { cx, cy, r0 } = PIZZA_GEOM
  const hasSel = selected >= 0 && selected < items.length

  const pick = (i: number) => {
    const it = items[i]
    if (it) onSelect?.(it, i)
  }

  return (
    <svg
      className={`pie-wrap${hasSel ? ' has-sel' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 340 340"
      role="group" /* its wedges are buttons: an «img» may not contain interactive children */
      aria-label="Ishlar taqsimoti, holatlar boʻyicha"
    >
      <defs>
        {items.map((it, i) => (
          <pattern key={i} id={`${uid}h${i}`} width={PIZZA_PAINT.hatch.size} height={PIZZA_PAINT.hatch.size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={PIZZA_PAINT.hatch.size} height={PIZZA_PAINT.hatch.size} fill={it.col} fillOpacity={PIZZA_PAINT.hatch.groundOpacity} />
            <line x1={0} y1={0} x2={0} y2={PIZZA_PAINT.hatch.size} stroke={it.col} strokeWidth={PIZZA_PAINT.hatch.stripeWidth} strokeOpacity={PIZZA_PAINT.hatch.stripeOpacity} />
          </pattern>
        ))}
      </defs>
      {model.rings.map((r, i) => (
        <circle key={i} className={`cring${r.edge ? ' edge' : ''}`} cx={cx} cy={cy} r={r.r} />
      ))}
      {model.wedges.map((w) => {
        const it = items[w.index]
        const isSel = hasSel && selected === w.index
        return (
          <g
            key={w.index}
            className={`cwedge${isSel ? ' sel' : ''}`}
            data-i={w.index}
            tabIndex={0}
            role="button"
            aria-pressed={isSel}
            aria-label={w.aria}
            // "Lift" the slice by growing it radially from the pie centre — this
            // keeps it concentric with the guide rings (they come forward with
            // it) instead of sliding off-grid the way a translate would.
            style={isSel ? { transform: 'scale(1.06)' } : undefined}
            onClick={() => pick(w.index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                pick(w.index)
              }
            }}
          >
            {w.bands.map((b) => (
              <path
                key={b.status}
                className={`cband ${b.status}`}
                d={b.path}
                {...bandPaint(b.status, it.col, `url(#${uid}h${w.index})`)}
              />
            ))}
            {w.split && <path className="csplit" d={w.split} />}
            {w.bands.map((b) =>
              b.text ? (
                <text key={b.status} className={b.status === 'won' ? 'cwon' : 'cnum'} x={b.text.x} y={b.text.y}>
                  {b.text.v}
                </text>
              ) : null,
            )}
            <rect
              x={w.pill.x - 12}
              y={w.pill.y - 8}
              width={24}
              height={16}
              rx={6}
              fill={w.pill.fill}
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
            <text className="ctot" x={w.pill.x} y={w.pill.y + 3.6}>
              {w.pill.v}
            </text>
          </g>
        )
      })}
      <circle className="pie-hub" cx={cx} cy={cy} r={r0} />
      {model.seams.map((s, i) => (
        <line key={i} className="csep" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
      ))}
    </svg>
  )
}

/** Win-rate ring — the prototypeʼs ringSvg2 (88px detail-panel gauge). */
export function WinRing({ pct, col, size = 88 }: { pct: number | null; col: string; size?: number }) {
  const g = winRingGeom(pct ?? 0, col)
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" aria-label={pct === null ? 'Hal qilingan ish yoʻq' : `Yutuq ${pct}%`}>
      <circle cx={44} cy={44} r={g.track} fill="none" stroke="var(--surface-inset)" strokeWidth={8} />
      <circle
        cx={44}
        cy={44}
        r={g.arc}
        fill="none"
        stroke={col}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={g.dash}
        transform={`rotate(${g.rotate} 44 44)`}
      />
      <text
        x={44}
        y={49}
        textAnchor="middle"
        fontSize={18}
        fontWeight={800}
        fill="var(--text-1)"
        fontFamily="var(--font-mono)"
      >
        {pct ?? '–'}
      </text>
    </svg>
  )
}

/** Detail panel body for one selected pizza wedge (prototype pieDetailHtml). */
export function PizzaDetail({
  item,
  kind,
  action,
}: {
  item: PizzaItem
  kind: string
  action?: React.ReactNode
}) {
  // «Jami» is ALL cases and the bands/rows below break it into its four statuses, drawn exactly
  // like the pie (the slice's hue; solid · tint · hatch · dashed). The win rate is the ONE app-wide
  // definition (core/rates.ts): won ÷ (won + lost) — neutral and in-progress cases are not in it.
  const counts = pizzaCounts(item)
  const total = pizzaTotal(item)
  const decided = item.won + item.lost
  const wr = winRate(item.won, item.lost)
  const seg = (v: number) => (total ? (v / total) * 100 : 0)
  const rows = PIZZA_STATUS_ORDER.filter((st) => counts[st] > 0 || st === 'won' || st === 'lost')

  return (
    <div>
      <div className="det-head">
        <span className="sw" style={{ background: item.col }} />
        <span className="k">{kind}</span>
      </div>
      <div className="det-name">{item.full}</div>
      <div className="det-sub">
        Jami {total} ish ·{' '}
        {wr === null ? 'hal qilingan ish yoʻq' : `yutuq ${wr}% (${decided} ta hal qilingan ishdan)`}
      </div>
      <div className="det-ring">
        <WinRing pct={wr} col={item.col} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="stackbar" style={{ ['--sw' as string]: item.col }}>
            {rows.map((st) =>
              counts[st] > 0 ? <i key={st} className={`st ${st}`} style={{ width: `${seg(counts[st])}%` }} /> : null,
            )}
          </div>
          <div className="det-sub" style={{ marginTop: 8 }}>
            Barcha holatlar boʻyicha taqsimot
          </div>
        </div>
      </div>
      <div className="det-rows" style={{ ['--sw' as string]: item.col }}>
        {rows.map((st) => (
          <div className="r" key={st}>
            <span className={`sw st ${st}`} />
            <span className="nm">{PIZZA_STATUS_LABEL[st]}</span>
            <span className="vl tnum">{counts[st]}</span>
          </div>
        ))}
      </div>
      {action}
    </div>
  )
}

/** Compact status key for under a pizza — the four fills, in the given hue. */
export function PizzaKey({ col = 'var(--text-3)' }: { col?: string }) {
  return (
    <div className="pie-key" style={{ ['--sw' as string]: col }} aria-hidden="true">
      {PIZZA_STATUS_ORDER.map((st) => (
        <span key={st}>
          <i className={`st ${st}`} />
          {PIZZA_STATUS_LABEL[st]}
        </span>
      ))}
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
