'use client'

/**
 * Prototype primitives — the Sud Signal signature visuals ported 1:1 from
 * sud-prototype.html: segmented ring gauge, arc gauge, bar chart with hover
 * tooltip, sparkline, count-up numbers, KPI card, segmented control.
 * All colors flow through the semantic tokens (color = signal only).
 */

import { useEffect, useRef, useState } from 'react'
import type { StatusFamily } from '@/core/status'

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
export function CountUp({ value, suffix = '', className }: { value: number; suffix?: string; className?: string }) {
  const skip = REDUCED || !Number.isFinite(value)
  const [display, setDisplay] = useState(skip ? value : Math.min(value, 0))
  const fromRef = useRef(0)
  useEffect(() => {
    if (skip) return
    const from = fromRef.current
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
  }, [value, skip])
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
export function ArcGauge({ pct, size, band = 'neu', label }: { pct: number; size: number; band?: Band; label?: string }) {
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
          <CountUp value={pct} suffix="%" />
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
  return (
    <div className="seg">
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
