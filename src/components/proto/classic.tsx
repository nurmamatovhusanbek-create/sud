'use client'

/**
 * The ORIGINAL (navy look, «Moviy») visuals that the newer looks replaced: the hairline instrument gauge (a needle on a dial) and the
 * pizza (radial stack) with its win-rate ring and detail panel. They are the 1:1 code of the last commit with the navy look (db29c3d),
 * kept here so «Moviy» is the original app and not the new layouts in navy colours. `Dial` (primitives) and the Statistika screen pick
 * these when `useLook()` says «navy»; the other looks never load them into the page's markup.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motionReduced } from '@/lib/motion'
import { bandFor, clampPct, dialAngle, dialGeom, tickLook, type DialZones } from './dial-geometry'
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
} from './pizza-geometry'
import { winRate } from '@/core/rates'

type Band = 'pos' | 'neg' | 'warn' | 'info' | 'neu'
const BAND_VAR: Record<Band, string> = {
  pos: 'var(--pos-base)',
  neg: 'var(--neg-base)',
  warn: 'var(--warn-base)',
  info: 'var(--info-base)',
  neu: 'var(--accent)',
}

const classicDialSeen = new Map<string, number>() // keyed dials remember where they were, so a remount doesn't replay from 0

export function ClassicDial({
  pct,
  size,
  band = 'neu',
  zones = null,
  label,
  unit = '',
  id,
}: {
  pct: number | null
  size: number
  band?: Band
  zones?: DialZones | null
  label?: string
  unit?: string
  id?: string
}) {
  const target = pct === null ? 0 : clampPct(pct)
  const geom = useMemo(() => dialGeom(size, zones), [size, zones])
  const start = id != null && classicDialSeen.has(id) ? (classicDialSeen.get(id) as number) : 0
  const [shown, setShown] = useState(start)
  const fromRef = useRef(start)
  useEffect(() => {
    if (id != null) classicDialSeen.set(id, target)
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

  const col = BAND_VAR[(bandFor(target, zones, band) as Band)]
  const num = size * (geom.small ? 0.22 : 0.27)
  return (
    <div className="dial" style={{ width: size, height: size }} role="img" aria-label={pct === null ? (label ?? 'Maʼlumot yoʻq') : `${label ? `${label}: ` : ''}${Math.round(target)}${unit}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {geom.ticks.map((t) => {
          const { lit, width } = tickLook(t, shown)
          const stroke = pct !== null && lit ? col : t.zone ? `color-mix(in srgb, ${BAND_VAR[t.zone]} 38%, var(--border-subtle))` : 'var(--border-default)'
          return <line key={t.v} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
        })}
        {geom.labels.map((l) => (
          <text key={l.v} x={l.x} y={l.y} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-3)">{l.v}</text>
        ))}
        {pct !== null && shown > 0.4 ? (
          <g transform={`rotate(${dialAngle(shown)} ${geom.cx} ${geom.cy})`}>
            <line x1={geom.needle.x1} y1={geom.needle.y1} x2={geom.needle.x2} y2={geom.needle.y2} stroke={col} strokeWidth={3} strokeLinecap="round" />
            <path d={geom.needle.tri} fill={col} />
          </g>
        ) : null}
      </svg>
      <div className="dial-ov" aria-hidden>
        <div className="dial-n">
          <span className="mono" style={{ fontSize: num }}>{pct === null ? '–' : Math.round(shown)}</span>
          {unit && pct !== null ? <span className="mono dial-u" style={{ fontSize: num * 0.45 }}>{unit}</span> : null}
        </div>
        {label && !geom.small ? <div className="faint" style={{ fontSize: size > 150 ? 11.5 : 10, marginTop: size > 150 ? 6 : 1 }}>{label}</div> : null}
      </div>
    </div>
  )
}


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
