/**
 * Company report — the «Premium» edition (selected when the app's look is Premium, the default).
 *
 * Same document, same model, same two-column «Dossier» structure as render.ts (which stays as the «Tinch» edition: navy rail, outcome
 * hues, pizza, dial). What changes is the identity, to match the app's Premium look:
 *   · ONE ink, no hue: ink rail, near-white (or graphite) paper, neutral greys. The four outcomes are told apart by FILL: won solid ·
 *     lost tint · neutral hatched · in progress dashed outline, so the page reads the same in light, dark and a grey print.
 *   · the pizza is the app's OutcomeBoard: a hero (the win rate, one strip of every case, four stat columns that are the legend and
 *     the numbers) and one tile per court type / category with its own 100 % composition;
 *   · the rating is a big number over a RULER of hairline ticks; hearings use the calendar leaf (month on an ink band, day big);
 *   · sentence-case labels, IBM Plex Sans / Mono, weights 400-600.
 * Pure string building; escapes everything it prints (see __tests__/xss.test.ts).
 */

import { escapeHtml as h } from '@/lib/print'
import { formatDmy } from '@/core/dates'
import { winRate as calcWinRate } from '@/core/rates'
import { MONTHS_UZ } from '@/core/trend'
import {
  PIZZA_STATUS_LABEL,
  PIZZA_STATUS_ORDER,
  pizzaCounts,
  pizzaTotal,
  type PizzaItem,
  type PizzaStatus,
} from '@/components/proto/pizza-geometry'
import { clampPct } from '@/components/proto/dial-geometry'
import { brandMarkSvg } from '@/core/brand-mark'
import { fmtInt, shortSum, type ReportModel, type Tone } from './model'
import { displayName, figure, note, railDl, railGroup, sec, type ReportTheme } from './render'

// ---- theme -------------------------------------------------------------------

export function inkTheme(dark: boolean): ReportTheme {
  const ink = dark ? '#EDEDED' : '#111114'
  const flat = { fg: ink, bg: dark ? 'rgba(237,237,237,.10)' : '#ECECEF' }
  return {
    dark,
    bg: dark ? '#0B0B0C' : '#F4F4F5',
    surface: dark ? '#141415' : '#FFFFFF',
    inset: dark ? '#19191B' : '#F6F6F7',
    t1: ink,
    t2: dark ? '#A1A1A6' : '#4A4A52',
    t3: dark ? '#85858B' : '#85858D',
    border: dark ? 'rgba(255,255,255,0.16)' : '#D9D9DD',
    borderSoft: dark ? 'rgba(255,255,255,0.08)' : '#E9E9EC',
    accent: ink,
    accentText: dark ? '#111114' : '#FFFFFF',
    accentSoft: dark ? 'rgba(237,237,237,.10)' : '#ECECEF',
    pos: ink,
    neg: ink,
    rail: { bg: dark ? '#09090A' : '#111114', tone: { pos: '#FFFFFF', neg: '#FFFFFF', warn: '#FFFFFF', info: '#FFFFFF', neu: '#C9C9CD' } },
    tone: { pos: flat, neg: flat, warn: flat, info: flat, neu: flat },
    ramp: dark ? ['#EDEDED', '#BDBDC1', '#8D8D93', '#5C5C62', '#3A3A3F', '#26262A'] : ['#111114', '#3A3A40', '#6B6B73', '#9A9AA2', '#C6C6CC', '#E4E4E8'],
  }
}

/** a tone is an outcome only through its FILL (never a hue) */
const FILL: Record<Tone, PizzaStatus> = { pos: 'won', neg: 'lost', neu: 'neutral', info: 'pending', warn: 'pending' }
const mark = (tone: Tone) => `<i class="rp-st ${FILL[tone]}"></i>`

// ---- SVG ---------------------------------------------------------------------

/** The rating: 51 hairline ticks (one per 2 points), a longer one every 10, lit up to the score. Drawn on the ink rail. */
function ruler(score: number | null): string {
  const W = 150, H = 20, n = 51
  const v = score === null ? -1 : clampPct(score)
  const ticks = Array.from({ length: n }, (_, i) => {
    const x = 1 + (i * (W - 2)) / (n - 1)
    const hgt = i % 5 === 0 ? 20 : 12
    return `<line x1="${x.toFixed(2)}" y1="${H}" x2="${x.toFixed(2)}" y2="${H - hgt}" stroke="${i * 2 <= v ? '#fff' : 'rgba(255,255,255,.24)'}" stroke-width="1.3" stroke-linecap="round"/>`
  }).join('')
  return `<svg class="rp-ruler" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reyting ${score ?? ''}">${ticks}</svg>`
}

/** 12 monthly bars; the current (last) month is solid ink, the rest a quiet step. */
function monthly(points: { label: string; count: number }[], t: ReportTheme): string {
  const max = Math.max(1, ...points.map((p) => p.count))
  const slot = 600 / points.length
  const bw = slot * 0.5
  const bars = points
    .map((p, i) => {
      const x = i * slot + (slot - bw) / 2
      const hgt = p.count ? Math.max(4, (p.count / max) * 58) : 1.5
      const y = 78 - hgt
      const last = i === points.length - 1
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="2" fill="${last ? t.ramp[0] : p.count ? t.ramp[3] : t.borderSoft}"/>
      ${p.count ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" class="rp-bar-v" fill="${t.t2}">${p.count}</text>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="95" text-anchor="middle" class="rp-bar-l" fill="${last ? t.t1 : t.t3}">${h(p.label)}</text>`
    })
    .join('')
  return `<svg class="rp-months" viewBox="0 0 600 100" role="img" aria-label="Oylik faollik">
    <line x1="0" y1="78" x2="600" y2="78" stroke="${t.border}" stroke-width="1"/>${bars}</svg>`
}

// ---- the rail (left column) --------------------------------------------------

function renderRail(m: ReportModel): string {
  const r = m.rating
  const status = m.status ? `<span class="st"><i></i>${h(m.status.text)}</span>` : ''
  const sub = [m.legalForm ? `<span>${h(m.legalForm)}</span>` : '', status].filter(Boolean).join('<span class="sep">·</span>')
  const rating = r
    ? `<div class="rp-rate"><div class="rp-rate-k">Hamkor reytingi · ${h(r.category)}</div><div class="rp-rate-n m">${r.score === null ? '–' : Math.round(clampPct(r.score))}</div>${ruler(r.score)}<div class="rp-rate-s m"><span>0</span><span>100</span></div></div>`
    : `<div class="rp-rate rp-rate-none">Reyting mavjud emas</div>`

  const facts = m.facts.filter((f) => f.label !== 'STIR' && f.label !== 'Holat')
  const rows = m.founders.rows
  const owners = rows.length
    ? `<div class="rp-own">${rows
        .map(
          (f) =>
            `<div><div class="r"><b>${h(f.name)}</b><span class="m">${h(f.share !== null ? `${String(f.share).replace('.', ',')}%` : f.text || '–')}</span></div>${
              f.share !== null ? `<div class="bar"><i style="width:${Math.min(100, f.share)}%"></i></div>` : ''
            }</div>`,
        )
        .join('')}${m.founders.others ? `<div class="more">yana ${m.founders.others} ta</div>` : ''}</div>`
    : ''

  return [
    `<h1>${h(displayName(m.name))}</h1>`,
    sub ? `<div class="rp-sub">${sub}</div>` : '',
    rating,
    railGroup('Asosiy maʼlumot', railDl(facts)),
    railGroup('Taʼsischilar', owners),
    railGroup('Aloqa', railDl(m.contacts)),
    railGroup('Roʻyxatga olish', railDl(m.registration)),
    railGroup('Faoliyat kodlari', railDl(m.codes)),
  ].join('\n')
}

// ---- the main column ---------------------------------------------------------

function kpis(m: ReportModel): string {
  return `<div class="rp-kpis">${m.kpis
    .map((k) => `<div class="rp-kpi"><div class="l">${h(k.label)}</div><div class="v">${figure(k.value)}</div>${k.sub ? `<div class="s">${h(k.sub)}</div>` : ''}</div>`)
    .join('')}</div>`
}

/** one strip: every case of a slice as ONE row of fills, proportional */
function strip(counts: Record<PizzaStatus, number>, size: 'lg' | 'sm'): string {
  const total = PIZZA_STATUS_ORDER.reduce((n, st) => n + counts[st], 0)
  return `<div class="rp-strip ${size}">${total === 0 ? '<i class="empty"></i>' : PIZZA_STATUS_ORDER.filter((st) => counts[st] > 0).map((st) => `<i class="rp-st ${st}" style="flex:${counts[st]}"></i>`).join('')}</div>`
}

/** the tiles: name, total, own 100 % composition, win rate */
function tiles(items: PizzaItem[]): string {
  return `<div class="rp-tiles">${items
    .map((it) => {
      const r = calcWinRate(it.won, it.lost)
      return `<div class="rp-tile"><div class="h"><span class="n">${h(it.full)}</span><b class="m">${fmtInt(pizzaTotal(it))}</b></div>${strip(pizzaCounts(it), 'sm')}<div class="f"><span>Yutuq</span><b class="m">${r === null ? '–' : `${r}%`}</b></div></div>`
    })
    .join('')}</div>`
}

function signature(m: ReportModel, t: ReportTheme): string {
  const c = m.cases
  if (!c) return ''
  const rate = c.winRate
  const counts: Record<PizzaStatus, number> = { won: c.win, lost: c.lose, neutral: c.neutral, pending: c.inProgress }
  const total = PIZZA_STATUS_ORDER.reduce((n, st) => n + counts[st], 0)
  const stats = PIZZA_STATUS_ORDER.map(
    (st) =>
      `<div class="rp-stat${counts[st] === 0 ? ' zero' : ''}"><div class="h"><i class="rp-st ${st}"></i>${PIZZA_STATUS_LABEL[st]}</div><b class="m">${fmtInt(counts[st])}</b><small class="m">${total ? `${Math.round((counts[st] / total) * 100)}%` : ''}</small></div>`,
  ).join('')
  const roles = c.asPlaintiff + c.asDefendant > 0 ? `<div class="rp-roles"><span>Daʼvogar / javobgar</span><b class="m">${fmtInt(c.asPlaintiff)} / ${fmtInt(c.asDefendant)}</b></div>` : ''
  const hero = `<div class="rp-hero">
      <div class="rp-big"><b>${rate === null ? '–' : `${rate}%`}</b><span>yutuq darajasi<small>${rate === null ? 'hal qilingan ish yoʻq' : `${fmtInt(c.win + c.lose)} ta hal qilingan ishdan`}</small></span></div>
      <div class="rp-hero-r">${strip(counts, 'lg')}<div class="rp-stats">${stats}</div>${roles}</div>
    </div>`
  const turkum = c.pieTurkum.length >= 2 ? `<div class="rp-block rp-avoid">${sec('Turkum boʻyicha')}${tiles(c.pieTurkum)}</div>` : ''
  return `<div class="rp-block rp-avoid">${sec('Taqsimot', `joriy ${fmtInt(c.inProgress)} · yakunlangan ${fmtInt(c.decided)}`)}${hero}
      ${c.pie.length ? `<div class="rp-sub-h">Sud turi boʻyicha</div>${tiles(c.pie)}` : ''}</div>
    ${
      c.results.length
        ? `<div class="rp-block rp-avoid">${sec('Natijalar')}<div class="rp-res">${c.results
            .map((r) => `<div>${mark(r.tone)}<span>${h(r.label)}</span><b class="m">${fmtInt(r.count)}</b></div>`)
            .join('')}</div></div>`
        : ''
    }
    <div class="rp-block rp-avoid">${sec('Oylik faollik', 'soʻnggi 12 oy')}${monthly(c.monthly, t)}</div>
    ${turkum}`
}

function latest(m: ReportModel): string {
  const c = m.cases
  if (!c || !c.latest.length) return ''
  return `<div class="rp-block">${sec('Soʻnggi ishlar', `jami ${fmtInt(c.total)}`)}<div class="rp-rows">${c.latest
    .map((r) => {
      const meta = [r.role === 'plaintiff' ? 'Daʼvogar' : 'Javobgar', r.result, r.number].filter(Boolean)
      return `<div class="r">${mark(r.tone)}<div class="w"><b>${h(r.party ? displayName(r.party) : '–')}</b><span>${meta.map((x, i) => (i === meta.length - 1 ? `<span class="m">${h(x)}</span>` : h(x))).join(' · ')}</span></div><div class="am"><b class="m">${r.amount !== null ? h(shortSum(r.amount)) : '–'}</b><span>${h(r.date)}</span></div></div>`
    })
    .join('')}</div></div>`
}

/** the calendar leaf: month on an ink band, the day big; inverted when the date is close */
function leaf(date: string, near: boolean): string {
  const mt = /^(\d{1,2})\.(\d{1,2})\./.exec(date)
  if (!mt) return `<span class="rp-leaf txt m">${h(date)}</span>`
  return `<span class="rp-leaf${near ? ' near' : ''}"><i>${h(MONTHS_UZ[Number(mt[2]) - 1] ?? '')}</i><b>${h(mt[1].padStart(2, '0'))}</b></span>`
}

function hearings(m: ReportModel): string {
  if (m.hearings === null) return ''
  return `<div class="rp-block">${sec('Yaqin majlislar')}${
    m.hearings.length
      ? m.hearings
          .map((x) => {
            const near = x.daysLeft !== null && x.daysLeft >= 0 && x.daysLeft <= 7
            const left = x.daysLeft !== null && x.daysLeft >= 0 ? (x.daysLeft === 0 ? 'Bugun' : x.daysLeft === 1 ? 'Ertaga' : `${x.daysLeft} kun qoldi`) : ''
            return `<div class="rp-hr">${leaf(x.date, near)}<div class="w"><b>${h(x.court || 'Sud')}</b><span>${x.caseNumber ? `Ish <span class="m">${h(x.caseNumber)}</span>` : ''}${x.judge ? ` · sudya ${h(x.judge)}` : ''}</span></div><div class="t">${x.time ? `<span class="m tm">${h(x.time)}</span>` : ''}${left ? `<span class="${near ? 'near' : ''}">${left}</span>` : ''}</div></div>`
          })
          .join('')
      : `<div class="rp-empty">Belgilangan majlis yoʻq</div>`
  }</div>`
}

function bills(m: ReportModel): string {
  const b = m.bills
  if (!b) return ''
  const paid = b.paidTotal / 100
  const over = b.overdueTotal / 100
  const bar =
    paid + over > 0
      ? `<div class="rp-strip lg rp-pay">${paid > 0 ? `<i class="rp-st won" style="flex:${paid}"></i>` : ''}${over > 0 ? `<i class="rp-st neutral" style="flex:${over}"></i>` : ''}</div>`
      : ''
  return `<div class="rp-block rp-avoid">${sec('Toʻlovlar', `${formatDmy(b.loadedAt)} holatiga`)}${bar}
    <div class="rp-pl"><span><b><i class="rp-st won"></i>${h(shortSum(paid))}</b>toʻlangan · ${fmtInt(b.paidCount)} / ${fmtInt(b.count)} kvitansiya</span><span class="r"><b><i class="rp-st neutral"></i>${h(shortSum(over))}</b>muddati oʻtgan</span></div></div>`
}

/** The report body: the rail cell and the main cell of the one table row. */
export function renderInkBody(m: ReportModel, t: ReportTheme): { rail: string; main: string } {
  return {
    rail: renderRail(m),
    main: [
      `<div class="rp-eyebrow">Sud faolligi</div><h2>Sudlardagi natijalar</h2>`,
      kpis(m),
      signature(m, t),
      latest(m),
      hearings(m),
      bills(m),
      m.notes.map(note).join(''),
    ].join('\n'),
  }
}

/** the logo as a quiet watermark in ONE ink: the mark's «tile» variant (white at four steps of opacity) recoloured to the page's ink */
export function renderInkWatermark(t: ReportTheme): string {
  return `<div class="rp-wm" aria-hidden="true">${brandMarkSvg('tile').replaceAll('#ffffff', t.t1)}</div>`
}

// ---- CSS ---------------------------------------------------------------------

const RAIL_W = '66mm'

export function inkCss(t: ReportTheme, fontStack: string, monoStack: string): string {
  const ink = t.t1
  return `
  :root { --bg:${t.surface}; --t1:${t.t1}; --t2:${t.t2}; --t3:${t.t3}; --bd:${t.border}; --bs:${t.borderSoft}; --ink:${ink}; --rail:${t.rail.bg}; --paper:${t.surface}; --inset:${t.inset}; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { background: var(--bg); }
  body { font-family: ${fontStack}; font-size: 8.4pt; line-height: 1.45; -webkit-font-smoothing: antialiased; color: var(--t1); }
  b, strong { font-weight: 600; }
  .m { font-family: ${monoStack}; font-variant-numeric: tabular-nums; }

  @page { size: A4; margin: 0 0 9mm; background: ${t.surface};
    @bottom-left { content: ""; width: ${RAIL_W}; background: ${t.rail.bg}; }
    @bottom-right { content: counter(page) " / " counter(pages); font: 500 7.5pt ${monoStack}; color: ${t.t3}; padding-right: 15mm; vertical-align: top; padding-top: 2mm; } }

  .rp-sheet { position: relative; isolation: isolate; width: 210mm; margin: 0 auto; }
  .rp-bg { position: absolute; z-index: -1; top: 0; bottom: 0; left: 0; width: ${RAIL_W}; background: var(--rail); }
  .rp-pin { position: absolute; bottom: 4mm; font-size: 6.4pt; line-height: 1.3; }
  .rp-pin-l { left: 11mm; width: 46mm; display: flex; justify-content: space-between; color: rgba(255,255,255,.5); }
  .rp-pin-r { left: calc(${RAIL_W} + 14mm); right: 15mm; color: var(--t3); }
  .rp-wm { position: absolute; z-index: -1; right: -24mm; bottom: -6mm; width: 124mm; opacity: ${t.dark ? 0.07 : 0.055}; pointer-events: none; }
  .rp-wm svg { display: block; width: 100%; height: auto; }
  @media print { .rp-bg, .rp-pin, .rp-wm { position: fixed; } .rp-bg { bottom: -9mm; } .rp-sheet { margin: 0; } }
  @media screen { .rp-sheet { overflow: hidden; background: var(--bg); box-shadow: 0 8px 40px rgba(0,0,0,.16); margin: 24px auto; min-height: 297mm; } body { padding-bottom: 24px; } html { background: ${t.dark ? t.bg : '#ECECEE'}; } }

  table.rp { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.rp col.l { width: ${RAIL_W}; }
  td.l { padding: 0 9mm 0 11mm; color: #fff; vertical-align: top; }
  td.r { padding: 0 15mm 0 14mm; vertical-align: top; }
  thead td { height: 15mm; }
  tfoot td { height: 14mm; }

  /* the four outcomes, ONE ink: solid · tint · hatch · dashed outline */
  .rp-st { --sw: var(--ink); display: inline-block; flex: none; }
  .rp-st.won { background: var(--sw); }
  .rp-st.lost { background: color-mix(in srgb, var(--sw) ${t.dark ? 50 : 34}%, transparent); }
  .rp-st.neutral { background: repeating-linear-gradient(45deg, var(--sw) 0 1.2px, color-mix(in srgb, var(--sw) 14%, transparent) 1.2px 3px); }
  .rp-st.pending { background: transparent; border: 1px dashed var(--sw); }

  /* rail */
  .rp-rail h1 { margin: 0 0 2.4mm; font-size: 14pt; line-height: 1.2; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .rp-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 2mm; font-size: 7.2pt; color: rgba(255,255,255,.72); }
  .rp-sub .sep { opacity: .5; }
  .rp-sub .st i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: #fff; }
  .rp-rate { break-inside: avoid; margin: 8mm 0 0; padding-top: 3mm; border-top: .5pt solid rgba(255,255,255,.18); }
  .rp-rate-k { font-size: 6.6pt; color: rgba(255,255,255,.6); }
  .rp-rate-n { margin: 1.6mm 0 3mm; font-size: 40pt; line-height: 1; font-weight: 600; letter-spacing: -.04em; }
  .rp-ruler { display: block; width: 100%; height: auto; }
  .rp-rate-s { display: flex; justify-content: space-between; margin-top: 1mm; font-size: 6pt; color: rgba(255,255,255,.5); }
  .rp-rate-none { padding: 3mm 0; font-size: 7pt; color: rgba(255,255,255,.6); }
  .rp-rg { break-inside: avoid; margin-top: 7mm; padding-top: 2.6mm; border-top: .5pt solid rgba(255,255,255,.18); }
  .rp-rg h3 { margin-bottom: 2.4mm; font-size: 6.6pt; font-weight: 500; color: rgba(255,255,255,.55); }
  .rp-rg dl > div { margin-bottom: 2.2mm; break-inside: avoid; }
  .rp-rg dt { font-size: 6pt; color: rgba(255,255,255,.5); }
  .rp-rg dd { font-size: 7.4pt; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
  .rp-rg dd.m { font-size: 7pt; }
  .rp-own > div { margin-bottom: 2.4mm; font-size: 7pt; line-height: 1.25; break-inside: avoid; }
  .rp-own .r { display: flex; justify-content: space-between; gap: 3mm; }
  .rp-own .r b { font-weight: 500; overflow-wrap: anywhere; }
  .rp-own .r span { flex: none; font-size: 6.6pt; color: rgba(255,255,255,.7); }
  .rp-own .bar { height: 2px; margin-top: 1.1mm; border-radius: 1px; background: rgba(255,255,255,.18); }
  .rp-own .bar i { display: block; height: 100%; border-radius: 1px; background: #fff; }
  .rp-own .more { font-size: 6.4pt; color: rgba(255,255,255,.5); }

  /* main */
  .rp-eyebrow { font-size: 7pt; font-weight: 500; color: var(--t3); }
  td.r h2 { margin: 1.2mm 0 6mm; font-size: 19pt; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
  .rp-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 5mm; }
  .rp-kpi { break-inside: avoid; padding-top: 2.4mm; border-top: 1.4pt solid var(--ink); }
  .rp-kpi .l { font-size: 6.8pt; font-weight: 500; color: var(--t2); }
  .rp-kpi .v { margin-top: 1.6mm; font: 600 21pt ${monoStack}; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rp-kpi .v small { margin-left: 1mm; font-size: 7.6pt; font-weight: 500; letter-spacing: 0; color: var(--t3); }
  .rp-kpi .s { margin-top: 1.6mm; font-size: 6.2pt; line-height: 1.35; color: var(--t3); }

  .rp-block { margin-top: 9mm; }
  .rp-avoid { break-inside: avoid; }
  .rp-sh { display: flex; align-items: center; gap: 3mm; margin-bottom: 3.6mm; font-size: 8.6pt; font-weight: 600; break-after: avoid; }
  .rp-sh::after { content: ""; order: 1; flex: 1; height: .5pt; background: var(--bd); }
  .rp-sh em { order: 2; font-style: normal; font-weight: 400; font-size: 6.6pt; color: var(--t3); }
  .rp-sub-h { margin: 6mm 0 2.4mm; font-size: 6.8pt; font-weight: 500; color: var(--t3); }

  /* outcome board: hero + strip + stat columns, then tiles */
  .rp-hero { display: grid; grid-template-columns: 46mm minmax(0, 1fr); gap: 8mm; align-items: end; }
  .rp-big b { display: block; font: 600 44pt ${monoStack}; line-height: .9; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
  .rp-big span { display: block; margin-top: 2.4mm; font-size: 7pt; font-weight: 500; color: var(--t2); }
  .rp-big small { display: block; margin-top: .6mm; font-size: 6.4pt; font-weight: 400; color: var(--t3); }
  .rp-strip { display: flex; gap: 1.2px; width: 100%; }
  .rp-strip i { display: block; flex-shrink: 1; height: 100%; min-width: 2px; border-radius: 2px; }
  .rp-strip.lg { height: 13mm; }
  .rp-strip.lg i { border-radius: 2.2mm; }
  .rp-strip.sm { height: 2.6mm; }
  .rp-strip i.empty { flex: 1; background: var(--bs); }
  .rp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3mm; margin-top: 4mm; }
  .rp-stat { padding-top: 2mm; border-top: .5pt solid var(--bd); }
  .rp-stat.zero { opacity: .5; }
  .rp-stat .h { display: flex; align-items: center; gap: 1.6mm; font-size: 6.4pt; color: var(--t2); }
  .rp-stat .h i { width: 10px; height: 7px; border-radius: 2px; margin-left: 0; }
  .rp-stat b { display: inline-block; margin-top: 1mm; font-size: 15pt; line-height: 1; letter-spacing: -.02em; }
  .rp-stat small { margin-left: 1.6mm; font-size: 6pt; color: var(--t3); }
  .rp-roles { display: flex; justify-content: space-between; gap: 2mm; margin-top: 3mm; padding-top: 1.6mm; border-top: .4pt solid var(--bs); font-size: 6.8pt; color: var(--t2); }
  .rp-roles b { color: var(--t1); font-weight: 600; }
  .rp-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3mm; }
  .rp-tile { break-inside: avoid; padding: 2.6mm 3mm; border: .5pt solid var(--bd); border-radius: 2.4mm; background: var(--inset); }
  .rp-tile .h { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; margin-bottom: 2mm; }
  .rp-tile .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 7.2pt; font-weight: 500; }
  .rp-tile .h b { font-size: 10pt; }
  .rp-tile .f { display: flex; justify-content: space-between; margin-top: 2mm; font-size: 6.2pt; color: var(--t3); }
  .rp-tile .f b { font-size: 6.6pt; font-weight: 500; color: var(--t2); }

  .rp-res { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8mm; }
  .rp-res > div { display: flex; align-items: center; gap: 2.4mm; padding: 1.6mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.2pt; break-inside: avoid; }
  .rp-res i { width: 10px; height: 7px; border-radius: 2px; flex: none; }
  .rp-res span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .rp-res b { font-weight: 600; font-size: 7.2pt; }
  .rp-months { display: block; width: 100%; height: auto; }
  .rp-bar-v { font: 500 10px ${monoStack}; }
  .rp-bar-l { font: 500 10px ${fontStack}; }

  /* latest cases + hearings: ruled rows, no boxes */
  .rp-rows .r { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 3.2mm; align-items: center; padding: 2.2mm 0; border-bottom: .4pt solid var(--bs); break-inside: avoid; }
  .rp-rows .r > i { height: 7px; border-radius: 2px; }
  .rp-rows .w b { display: block; font-size: 7.6pt; overflow-wrap: anywhere; }
  .rp-rows .w span { font-size: 6.4pt; color: var(--t3); overflow-wrap: anywhere; }
  .rp-rows .am { text-align: right; }
  .rp-rows .am b { display: block; font-size: 7.4pt; font-weight: 500; white-space: nowrap; }
  .rp-rows .am span { font-size: 6.4pt; color: var(--t3); white-space: nowrap; }
  .rp-hr { display: grid; grid-template-columns: 11mm minmax(0, 1fr) auto; gap: 4mm; align-items: center; padding: 2.4mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.4pt; break-inside: avoid; }
  .rp-leaf { display: inline-flex; flex-direction: column; width: 11mm; height: 12.6mm; border: .6pt solid var(--ink); border-radius: 1.8mm; overflow: hidden; background: var(--paper); }
  .rp-leaf i { display: grid; place-items: center; height: 3.6mm; font-style: normal; font-size: 5.6pt; font-weight: 600; background: var(--ink); color: var(--paper); }
  .rp-leaf b { flex: 1; display: grid; place-items: center; font: 600 11pt ${monoStack}; color: var(--ink); }
  .rp-leaf.near b { background: var(--ink); color: var(--paper); }
  .rp-leaf.near i { background: var(--paper); color: var(--ink); }
  .rp-leaf.txt { width: auto; padding: 0 1mm; font-size: 6.6pt; align-items: center; justify-content: center; }
  .rp-hr .w b { display: block; }
  .rp-hr .w span { font-size: 6.6pt; color: var(--t3); }
  .rp-hr .t { display: flex; flex-direction: column; align-items: flex-end; font-size: 6.6pt; color: var(--t3); line-height: 1.3; }
  .rp-hr .t .tm { font-size: 9pt; font-weight: 600; color: var(--t1); }
  .rp-hr .t .near { font-weight: 600; color: var(--t1); }
  .rp-empty { padding: 2.4mm 0; font-size: 7.4pt; color: var(--t3); }

  .rp-pay { margin: 0 0 3mm; height: 6mm; }
  .rp-pl { display: flex; justify-content: space-between; gap: 4mm; font-size: 6.8pt; color: var(--t2); }
  .rp-pl b { display: flex; align-items: center; gap: 1.6mm; font: 600 12pt ${monoStack}; letter-spacing: -.02em; color: var(--t1); }
  .rp-pl b i { width: 10px; height: 7px; border-radius: 2px; }
  .rp-pl .r { text-align: right; }
  .rp-pl .r b { justify-content: flex-end; }

  /* honest gaps */
  .rp-note { margin-top: 5mm; padding: 2.4mm 3.2mm; border: 1px dashed var(--ink); border-radius: 2mm; background: var(--inset); font-size: 7.2pt; break-inside: avoid; }
  `
}
