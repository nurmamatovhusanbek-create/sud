/**
 * Company report — the design («Dossier»).
 *
 * Turns a ReportModel into HTML + inline SVG (no chart library, no external
 * assets) and the CSS that styles it. Pure string building, so it renders the same
 * in the print window, in a test, and in a headless PDF render.
 *
 * Layout: a navy RAIL on the left (identity, rating gauge, facts, founders, contacts,
 * codes) and the analysis on the right (key figures, the pizza, results, months,
 * latest cases, hearings, payments). No cards: hairlines, big numerals and white space.
 * Both columns are cells of one table row, so each flows (and breaks) across pages on
 * its own; the table's thead repeats the brand line on every page, the rail colour is a
 * fixed strip, and the pinned footer repeats too.
 *
 * Outcomes have ONE color each everywhere on the page (teal won · vermilion lost ·
 * indigo in progress · slate neutral) — chosen to stay apart under color-blind
 * simulation (checked with the dataviz validator in both themes); the navy→indigo
 * ramp is only for magnitude and shares. Type stays light: nothing above weight 700.
 */

import { escapeHtml as h, palette, type Palette } from '@/lib/print'
import { formatDmy } from '@/core/dates'
import { winRate as calcWinRate } from '@/core/rates'
import {
  PIZZA_GEOM,
  PIZZA_PAINT,
  PIZZA_STATUS_LABEL,
  PIZZA_STATUS_ORDER,
  pizzaModel,
  pizzaTotal,
  type PizzaItem,
  type PizzaStatus,
} from '@/components/proto/pizza-geometry'
import { clampPct, dialAngle, dialGeom, tickLook } from '@/components/proto/dial-geometry'
import { fmtInt, shortSum, type ReportModel, type Tone } from './model'

// ---- theme -------------------------------------------------------------------

export interface ReportTheme extends Palette {
  dark: boolean
  tone: Record<Tone, { fg: string; bg: string }>
  /** the left rail: always a dark field with light text, in both themes */
  rail: { bg: string; tone: Record<Tone, string> }
  /** navy ramp for magnitude / shares, strongest first (kept apart from the outcome hues) */
  ramp: string[]
}

/** outcome / status colours that read on the navy rail (the page tones are too dark there) */
const RAIL_TONE: Record<Tone, string> = { pos: '#34d3b4', neg: '#ff8077', warn: '#f0be5e', info: '#93a4ff', neu: '#aab3d8' }

export function reportTheme(dark: boolean): ReportTheme {
  const p = palette(dark)
  return dark
    ? {
        ...p,
        dark: true,
        rail: { bg: '#232b63', tone: RAIL_TONE },
        tone: {
          pos: { fg: '#1aa593', bg: 'rgba(26,165,147,.17)' },
          neg: { fg: '#e2544c', bg: 'rgba(226,84,76,.17)' },
          warn: { fg: '#e2a94a', bg: 'rgba(226,169,74,.16)' },
          info: { fg: '#6f85ea', bg: 'rgba(111,133,234,.18)' },
          neu: { fg: '#8f98bf', bg: 'rgba(143,152,191,.15)' },
        },
        ramp: ['#a9b6f2', '#8093d9', '#6072b8', '#465694', '#34427a', '#2a3563'],
      }
    : {
        ...p,
        dark: false,
        rail: { bg: '#141b47', tone: RAIL_TONE },
        tone: {
          pos: { fg: '#0f9d8f', bg: '#e0f4f1' },
          neg: { fg: '#d8443c', bg: '#fce9e7' },
          warn: { fg: '#b7791f', bg: '#fdf3df' },
          info: { fg: '#4c5fd5', bg: '#e8ebfb' },
          neu: { fg: '#7d86ab', bg: '#eceef6' },
        },
        ramp: ['#1a2350', '#34427c', '#5f6fa8', '#9aa6cf', '#c7cee6', '#e3e7f3'],
      }
}

// ---- SVG ---------------------------------------------------------------------

/**
 * The rating dial, drawn static on the dark rail. Same geometry as the app's Dial
 * (components/proto/dial-geometry.ts): 51 hairline ticks over 270°, numerals 0 · 50 · 100,
 * lit up to the score, a needle with a pointer at the score.
 */
function gauge(score: number | null, tone: Tone, t: ReportTheme): string {
  const S = 150
  const g = dialGeom(S)
  const col = t.rail.tone[tone]
  const v = score === null ? 0 : clampPct(score)
  const ticks = g.ticks
    .map((k) => {
      const { lit, width } = tickLook(k, score === null ? -1 : v)
      return `<line x1="${k.x1.toFixed(2)}" y1="${k.y1.toFixed(2)}" x2="${k.x2.toFixed(2)}" y2="${k.y2.toFixed(2)}" stroke="${lit ? col : 'rgba(255,255,255,.2)'}" stroke-width="${width.toFixed(2)}" stroke-linecap="round"/>`
    })
    .join('')
  const labels = g.labels.map((l) => `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="middle" class="rp-dial-l">${l.v}</text>`).join('')
  const needle =
    score === null
      ? ''
      : `<g transform="rotate(${dialAngle(v).toFixed(2)} ${g.cx} ${g.cy})"><line x1="${g.needle.x1}" y1="${g.needle.y1.toFixed(2)}" x2="${g.needle.x2}" y2="${g.needle.y2.toFixed(2)}" stroke="${col}" stroke-width="3" stroke-linecap="round"/><path d="${g.needle.tri}" fill="${col}"/></g>`
  return `<svg class="rp-gauge" viewBox="0 0 ${S} ${S}" role="img" aria-label="Reyting ${score ?? ''}">${ticks}${labels}${needle}
    <text x="${S / 2}" y="${S / 2 + 11}" text-anchor="middle" class="rp-gauge-n" fill="#fff">${score === null ? '–' : Math.round(v)}</text>
  </svg>`
}

/**
 * The signature chart: the SAME pizza as Statistika (radial stack) — one wedge per court type,
 * each wedge's radius its own 100% stacked hub → rim as yutgan · yutqazgan · neytral · jarayonda
 * (solid · tint · hatch · dashed, in the slice's hue). The geometry is the app's own
 * (components/proto/pizza-geometry.ts), so the two can never drift; only the paint differs.
 */
function pizza(items: PizzaItem[], t: ReportTheme, id = 'rpz'): string {
  const model = pizzaModel(items)
  const { cx, cy, r0 } = PIZZA_GEOM
  const lostOp = PIZZA_PAINT.lostOpacity(t.dark)
  const hz = PIZZA_PAINT.hatch
  const pd = PIZZA_PAINT.pending
  const paint = (status: PizzaStatus, col: string, hatch: string) =>
    status === 'won'
      ? `fill="${col}" stroke="${t.surface}" stroke-width="0.8"`
      : status === 'lost'
        ? `fill="${col}" fill-opacity="${lostOp}" stroke="${t.surface}" stroke-width="0.8"`
        : status === 'neutral'
          ? `fill="url(#${hatch})" stroke="${t.surface}" stroke-width="0.8"`
          : `fill="${col}" fill-opacity="${pd.fillOpacity}" stroke="${col}" stroke-width="${pd.strokeWidth}" stroke-dasharray="${pd.dash}"`
  const defs = items
    .map(
      (it, i) =>
        `<pattern id="${id}${i}" width="${hz.size}" height="${hz.size}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${hz.size}" height="${hz.size}" fill="${it.col}" fill-opacity="${hz.groundOpacity}"/><line x1="0" y1="0" x2="0" y2="${hz.size}" stroke="${it.col}" stroke-width="${hz.stripeWidth}" stroke-opacity="${hz.stripeOpacity}"/></pattern>`,
    )
    .join('')
  const rings = model.rings
    .map(
      (g) =>
        `<circle cx="${cx}" cy="${cy}" r="${g.r}" fill="none" stroke="${g.edge ? t.border : t.borderSoft}" stroke-width="1"${g.edge ? '' : ' stroke-dasharray="3 5"'}/>`,
    )
    .join('')
  const wedges = model.wedges
    .map((w) => {
      const it = items[w.index]
      const bands = w.bands.map((b) => `<path d="${b.path}" ${paint(b.status, it.col, `${id}${w.index}`)}/>`).join('')
      const nums = w.bands
        .map((b) =>
          b.text
            ? `<text x="${b.text.x}" y="${b.text.y}" class="${b.status === 'won' ? 'rp-pz-w' : 'rp-pz-n'}" text-anchor="middle">${b.text.v}</text>`
            : '',
        )
        .join('')
      const pill = `<rect x="${w.pill.x - 13}" y="${w.pill.y - 9}" width="26" height="18" rx="6" fill="${w.pill.fill}" stroke="${t.surface}" stroke-width="1.5"/><text x="${w.pill.x}" y="${w.pill.y + 4}" class="rp-pz-t" text-anchor="middle">${w.pill.v}</text>`
      const split = w.split ? `<path d="${w.split}" fill="${t.surface}"/>` : ''
      return `<g>${bands}${split}${nums}${pill}</g>`
    })
    .join('')
  const seams = model.seams
    .map((s) => `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${t.t2}" stroke-width="1.3" stroke-dasharray="1.5 4" stroke-linecap="round" opacity=".8"/>`)
    .join('')
  const aria = model.wedges.map((w) => w.aria).join('; ')
  return `<svg class="rp-pie" viewBox="0 0 340 340" role="img" aria-label="${h(aria)}"><defs>${defs}</defs>${rings}${wedges}<circle cx="${cx}" cy="${cy}" r="${r0}" fill="${t.surface}" stroke="${t.borderSoft}"/>${seams}</svg>`
}

/** 12 monthly bars; the current (last) month is drawn in the strongest navy. */
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
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="1.5" fill="${last ? t.ramp[0] : p.count ? t.ramp[4] : t.borderSoft}"/>
      ${p.count ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" class="rp-bar-v" fill="${t.t2}">${p.count}</text>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="95" text-anchor="middle" class="rp-bar-l" fill="${last ? t.t1 : t.t3}">${h(p.label)}</text>`
    })
    .join('')
  return `<svg class="rp-months" viewBox="0 0 600 100" role="img" aria-label="Oylik faollik">
    <line x1="0" y1="78" x2="600" y2="78" stroke="${t.border}" stroke-width="1"/>${bars}</svg>`
}

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v5c0 4.5 3.2 7.9 8 9 4.8-1.1 8-4.5 8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>`

// ---- HTML pieces -------------------------------------------------------------

/** "PROCAB" MChJ → “PROCAB” MChJ — paired straight quotes become typographic ones. */
const displayName = (name: string) => name.replace(/"([^"]*)"/g, '“$1”')

/** «1,2 mlrd» → numeral + small unit; «325 700» (grouped digits) stays whole. */
function figure(v: string): string {
  const m = /^(.+?) (mln|mlrd)$/.exec(v)
  return m ? `${h(m[1])}<small>${h(m[2])}</small>` : h(v)
}

const sec = (title: string, right = '') => `<div class="rp-sh"><span>${h(title)}</span>${right ? `<em>${h(right)}</em>` : ''}</div>`

const railGroup = (title: string, body: string) => (body ? `<div class="rp-rg"><h3>${h(title)}</h3>${body}</div>` : '')

const railDl = (rows: { label: string; value: string; mono?: boolean }[]) =>
  rows.length ? `<dl>${rows.map((r) => `<div><dt>${h(r.label)}</dt><dd${r.mono ? ' class="m"' : ''}>${h(r.value)}</dd></div>`).join('')}</dl>` : ''

const note = (n: { section: string; message: string }) => `<div class="rp-note"><b>${h(n.section)}:</b> maʼlumot olinmadi</div>`

// ---- the rail (left column) --------------------------------------------------

function renderRail(m: ReportModel, t: ReportTheme): string {
  const r = m.rating
  const status = m.status ? `<span class="st"><i style="background:${t.rail.tone[m.status.tone]}"></i>${h(m.status.text)}</span>` : ''
  const sub = [m.legalForm ? `<span>${h(m.legalForm)}</span>` : '', status].filter(Boolean).join('<span class="sep">·</span>')
  const rating = r
    ? `<div class="rp-rate">${gauge(r.score, r.tone, t)}<div class="rp-rate-c">Hamkor reytingi · ${h(r.category)}</div></div>`
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

/** One tick colour per key figure: navy for volume, teal for the won-share, amber for what is coming. */
function kpis(m: ReportModel, t: ReportTheme): string {
  const ticks = [t.ramp[0], t.tone.pos.fg, t.ramp[2], t.tone.warn.fg]
  return `<div class="rp-kpis">${m.kpis
    .map(
      (k, i) =>
        `<div class="rp-kpi"><div class="v"${k.tone ? ` style="color:${t.tone[k.tone].fg}"` : ''}>${figure(k.value)}</div><i class="tick" style="background:${ticks[i % ticks.length]}"></i><div class="l">${h(k.label)}</div>${k.sub ? `<div class="s">${h(k.sub)}</div>` : ''}</div>`,
    )
    .join('')}</div>`
}

/** «name · total · win rate» rows beside a pie. */
function sliceList(items: PizzaItem[]): string {
  return `<div class="rp-slices">${items
    .map((it) => {
      const r = calcWinRate(it.won, it.lost)
      return `<div><i style="background:${it.col}"></i><span class="n">${h(it.full)}</span><b>${fmtInt(pizzaTotal(it))}</b><span class="p">${r === null ? '–' : `${r}%`}</span></div>`
    })
    .join('')}</div>`
}

/** What the four fills of the pizza mean (solid · tint · hatch · dashed), without numbers. */
function pizzaKey(): string {
  return `<div class="rp-stkey">${PIZZA_STATUS_ORDER.map((st) => `<span><i class="rp-st ${st}"></i>${PIZZA_STATUS_LABEL[st]}</span>`).join('')}</div>`
}

function signature(m: ReportModel, t: ReportTheme): string {
  const c = m.cases
  if (!c) return ''
  const rate = c.winRate
  const seg: [string, number, Tone][] = [
    ['Yutgan', c.win, 'pos'],
    ['Yutqazgan', c.lose, 'neg'],
    ['Neytral', c.neutral, 'neu'],
    ['Jarayonda', c.inProgress, 'info'],
  ]
  const bar = seg.filter(([, n]) => n > 0).map(([, n, tone]) => `<span style="flex:${n};background:${t.tone[tone].fg}"></span>`).join('')
  const legend = seg.filter(([, n]) => n > 0).map(([label, n, tone]) => `<span><i style="background:${t.tone[tone].fg}"></i>${label} <b>${fmtInt(n)}</b></span>`).join('')
  const roles = c.asPlaintiff + c.asDefendant > 0 ? `<div class="rp-roles"><span>Daʼvogar / javobgar</span><b class="m">${fmtInt(c.asPlaintiff)} / ${fmtInt(c.asDefendant)}</b></div>` : ''
  const hero = `<div class="rp-hero">
      <div class="rp-pie-wrap">${pizza(c.pie, t, 'rpzc')}${pizzaKey()}</div>
      <div class="rp-hero-r">
        <div class="rp-big"><b>${rate === null ? '–' : `${rate}%`}</b><span>yutuq darajasi<small>${rate === null ? 'hal qilingan ish yoʻq' : `${fmtInt(c.win + c.lose)} ta hal qilingan ishdan`}</small></span></div>
        <div class="rp-seg">${bar}</div><div class="rp-segl">${legend}</div>
        ${sliceList(c.pie)}${roles}
      </div>
    </div>`
  // the category split gets its own small pie when it says something (≥ 2 categories)
  const turkum =
    c.pieTurkum.length >= 2
      ? `<div class="rp-block rp-avoid">${sec('Turkum boʻyicha')}<div class="rp-hero rp-hero-s"><div class="rp-pie-wrap">${pizza(c.pieTurkum, t, 'rpzt')}</div><div class="rp-hero-r">${sliceList(c.pieTurkum)}</div></div></div>`
      : ''
  return `<div class="rp-block rp-avoid">${sec('Taqsimot', `joriy ${fmtInt(c.inProgress)} · yakunlangan ${fmtInt(c.decided)}`)}${hero}</div>
    ${
      c.results.length
        ? `<div class="rp-block rp-avoid">${sec('Natijalar')}<div class="rp-res">${c.results
            .map((r) => `<div><i style="background:${t.tone[r.tone].fg}"></i><span>${h(r.label)}</span><b class="m">${fmtInt(r.count)}</b></div>`)
            .join('')}</div></div>`
        : ''
    }
    <div class="rp-block rp-avoid">${sec('Oylik faollik', 'soʻnggi 12 oy')}${monthly(c.monthly, t)}</div>
    ${turkum}`
}

function latest(m: ReportModel, t: ReportTheme): string {
  const c = m.cases
  if (!c || !c.latest.length) return ''
  return `<div class="rp-block">${sec('Soʻnggi ishlar', `jami ${fmtInt(c.total)}`)}<div class="rp-rows">${c.latest
    .map((r) => {
      const meta = [r.role === 'plaintiff' ? 'Daʼvogar' : 'Javobgar', r.result, r.number].filter(Boolean)
      return `<div class="r"><i style="background:${t.tone[r.tone].fg}"></i><div class="w"><b>${h(r.party ? displayName(r.party) : '–')}</b><span>${meta.map((x, i) => (i === meta.length - 1 ? `<span class="m">${h(x)}</span>` : h(x))).join(' · ')}</span></div><div class="am"><b class="m">${r.amount !== null ? h(shortSum(r.amount)) : '–'}</b><span>${h(r.date)}</span></div></div>`
    })
    .join('')}</div></div>`
}

function hearings(m: ReportModel, t: ReportTheme): string {
  if (m.hearings === null) return ''
  return `<div class="rp-block">${sec('Yaqin majlislar')}${
    m.hearings.length
      ? m.hearings
          .map((x) => {
            const left = x.daysLeft !== null && x.daysLeft >= 0 ? (x.daysLeft === 0 ? 'Bugun' : `${x.daysLeft} kun`) : ''
            return `<div class="rp-hr"><b class="m d">${h(x.date)}</b><div class="w"><b>${h(x.court || 'Sud')}</b><span>${x.caseNumber ? `Ish <span class="m">${h(x.caseNumber)}</span>` : ''}${x.judge ? ` · sudya ${h(x.judge)}` : ''}</span></div><div class="t">${x.time ? `<span class="m">${h(x.time)}</span>` : ''}${left ? `<span style="color:${x.daysLeft! <= 7 ? t.tone.warn.fg : t.t3}">${left}</span>` : ''}</div></div>`
          })
          .join('')
      : `<div class="rp-empty">Belgilangan majlis yoʻq</div>`
  }</div>`
}

function bills(m: ReportModel, t: ReportTheme): string {
  const b = m.bills
  if (!b) return ''
  const paid = b.paidTotal / 100
  const over = b.overdueTotal / 100
  const bar =
    paid + over > 0
      ? `<div class="rp-pay"><span style="flex:${paid};background:${t.ramp[0]}"></span>${over > 0 ? `<span style="flex:${over};background:${t.tone.neg.fg}"></span>` : ''}</div>`
      : ''
  return `<div class="rp-block rp-avoid">${sec('Toʻlovlar', `${formatDmy(b.loadedAt)} holatiga`)}${bar}
    <div class="rp-pl"><span><b>${h(shortSum(paid))}</b>toʻlangan · ${fmtInt(b.paidCount)} / ${fmtInt(b.count)} kvitansiya</span><span class="r"${over > 0 ? ` style="color:${t.tone.neg.fg}"` : ''}><b>${h(shortSum(over))}</b>muddati oʻtgan</span></div></div>`
}

/** The main column. */
function renderMain(m: ReportModel, t: ReportTheme): string {
  return [
    `<div class="rp-eyebrow">Sud faolligi</div><h2>Sudlardagi natijalar</h2>`,
    kpis(m, t),
    signature(m, t),
    latest(m, t),
    hearings(m, t),
    bills(m, t),
    m.notes.map(note).join(''),
  ].join('\n')
}

/** The report body: the rail cell and the main cell of the one table row. */
export function renderReportBody(m: ReportModel, t: ReportTheme): { rail: string; main: string } {
  return { rail: renderRail(m, t), main: renderMain(m, t) }
}

/** Running header (thead, repeats on every printed page): the brand line over the rail. */
export function renderReportHeader(): string {
  return `<div class="rp-brand">Sud tizimi · Hisobot</div>`
}

/** Pinned bottom line (repeats on every page): the company key on the rail, the disclaimer beside it. No source names. */
export function renderReportFooter(m: ReportModel): { rail: string; main: string } {
  return {
    rail: `<span class="m">STIR ${h(m.stir)}</span><span>${h(formatDmy(m.generatedAt))}</span>`,
    main: `Hisobot tuzilgan paytdagi holatni aks ettiradi va rasmiy hujjat hisoblanmaydi.`,
  }
}

// ---- CSS ---------------------------------------------------------------------

const RAIL_W = '66mm'

export function reportCss(t: ReportTheme, fontStack: string, monoStack: string): string {
  const pageBg = t.surface
  return `
  :root { --bg:${pageBg}; --t1:${t.t1}; --t2:${t.t2}; --t3:${t.t3}; --bd:${t.border}; --bs:${t.borderSoft}; --a:${t.accent}; --rail:${t.rail.bg}; --gd:${t.surface}; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { background: var(--bg); }
  body { font-family: ${fontStack}; font-size: 8.4pt; line-height: 1.45; -webkit-font-smoothing: antialiased; color: var(--t1); }
  b, strong { font-weight: 600; }
  .m { font-family: ${monoStack}; font-variant-numeric: tabular-nums; }

  /* page: paper in the page colour; the bottom margin band keeps the rail colour under the rail
     (margin boxes: Chrome/Edge 131+; elsewhere that strip is just paper) and holds the page counter */
  @page { size: A4; margin: 0 0 9mm; background: ${pageBg};
    @bottom-left { content: ""; width: ${RAIL_W}; background: ${t.rail.bg}; }
    @bottom-right { content: counter(page) " / " counter(pages); font: 500 7.5pt ${fontStack}; color: ${t.t3}; padding-right: 15mm; vertical-align: top; padding-top: 2mm; } }

  .rp-sheet { position: relative; width: 210mm; margin: 0 auto; }
  /* the rail colour behind the left column + the pinned footer: fixed = repeats on every printed page */
  .rp-bg { position: absolute; z-index: -1; top: 0; bottom: 0; left: 0; width: ${RAIL_W}; background: var(--rail); }
  .rp-pin { position: absolute; bottom: 4mm; font-size: 6.4pt; line-height: 1.3; }
  .rp-pin-l { left: 11mm; width: 46mm; display: flex; justify-content: space-between; color: rgba(255,255,255,.5); }
  .rp-pin-r { left: calc(${RAIL_W} + 14mm); right: 15mm; color: var(--t3); }
  @media print { .rp-bg, .rp-pin { position: fixed; } .rp-bg { bottom: -9mm; } .rp-sheet { margin: 0; } }
  @media screen { .rp-sheet { background: var(--bg); box-shadow: 0 8px 40px rgba(20,24,52,.18); margin: 24px auto; min-height: 297mm; } body { padding-bottom: 24px; } html { background: ${t.dark ? t.bg : '#e9ebf5'}; } }

  table.rp { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.rp col.l { width: ${RAIL_W}; }
  td.l { padding: 0 9mm 0 11mm; color: #fff; vertical-align: top; }
  td.r { padding: 0 15mm 0 14mm; vertical-align: top; }
  thead td { height: 19mm; vertical-align: bottom; padding-bottom: 5mm; }
  tfoot td { height: 14mm; }
  .rp-brand { font-size: 5.8pt; letter-spacing: .2em; text-transform: uppercase; font-weight: 700; color: rgba(255,255,255,.55); }

  /* rail */
  .rp-rail h1 { margin: 0 0 2.4mm; font-size: 14pt; line-height: 1.2; font-weight: 700; letter-spacing: -.015em; overflow-wrap: anywhere; }
  .rp-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 2mm; font-size: 7.2pt; color: rgba(255,255,255,.75); }
  .rp-sub .sep { opacity: .5; }
  .rp-sub i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
  .rp-rate { break-inside: avoid; margin: 7mm 0 0; }
  .rp-gauge { display: block; width: 44mm; height: auto; margin: 0 auto; }
  .rp-gauge-n { font: 600 40px ${monoStack}; letter-spacing: -.04em; }
  .rp-dial-l { font: 400 8.5px ${monoStack}; fill: rgba(255,255,255,.5); }
  .rp-rate-c { margin-top: -4mm; text-align: center; font-size: 6.4pt; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.55); }
  .rp-rate-none { padding: 3mm 0; text-align: center; font-size: 7pt; color: rgba(255,255,255,.55); border: 1px dashed rgba(255,255,255,.25); border-radius: 2mm; }
  .rp-rg { break-inside: avoid; margin-top: 7mm; padding-top: 2.6mm; border-top: .5pt solid rgba(255,255,255,.18); }
  .rp-rg h3 { margin-bottom: 2.4mm; font-size: 5.9pt; letter-spacing: .18em; text-transform: uppercase; font-weight: 700; color: rgba(255,255,255,.5); }
  .rp-rg dl > div { margin-bottom: 2.2mm; break-inside: avoid; }
  .rp-rg dt { font-size: 5.9pt; color: rgba(255,255,255,.5); }
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
  .rp-eyebrow { font-size: 6.2pt; letter-spacing: .18em; text-transform: uppercase; font-weight: 700; color: var(--t3); }
  td.r h2 { margin: 1.4mm 0 6mm; font-size: 19pt; line-height: 1.15; font-weight: 700; letter-spacing: -.02em; }
  .rp-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 5mm; }
  .rp-kpi { break-inside: avoid; }
  .rp-kpi .v { font-size: 21pt; line-height: 1; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rp-kpi .v small { margin-left: 1mm; font-size: 7.6pt; font-weight: 600; letter-spacing: 0; color: var(--t3); }
  .rp-kpi .tick { display: block; width: 10mm; height: 2.4px; margin: 2.6mm 0 1.8mm; border-radius: 2px; }
  .rp-kpi .l { font-size: 6.8pt; font-weight: 700; }
  .rp-kpi .s { margin-top: .6mm; font-size: 6.2pt; line-height: 1.35; color: var(--t3); }

  .rp-block { margin-top: 9mm; }
  .rp-avoid { break-inside: avoid; }
  .rp-sh { display: flex; align-items: center; gap: 3mm; margin-bottom: 3.6mm; font-size: 7pt; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; break-after: avoid; }
  .rp-sh::after { content: ""; order: 1; flex: 1; height: .5pt; background: var(--bd); }
  .rp-sh em { order: 2; font-style: normal; font-weight: 500; letter-spacing: .02em; text-transform: none; font-size: 6.6pt; color: var(--t3); }

  /* the pizza + the verdict beside it */
  .rp-hero { display: grid; grid-template-columns: 64mm minmax(0, 1fr); gap: 7mm; align-items: center; }
  .rp-hero-s { grid-template-columns: 42mm minmax(0, 1fr); }
  .rp-pie { display: block; width: 100%; height: auto; }
  .rp-pz-t { font: 600 11px ${monoStack}; fill: #fff; }
  .rp-pz-w { font: 600 10.5px ${monoStack}; fill: #fff; stroke: rgba(18, 24, 58, .3); stroke-width: .6px; paint-order: stroke; }
  .rp-pz-n { font: 500 10px ${monoStack}; fill: var(--t2); stroke: var(--gd); stroke-opacity: .85; stroke-width: 1.6px; paint-order: stroke; }
  .rp-big b { display: block; font-size: 36pt; line-height: 1; font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
  .rp-big span { display: block; margin-top: 1.2mm; font-size: 7pt; font-weight: 600; color: var(--t2); }
  .rp-big small { display: block; font-size: 6.4pt; font-weight: 500; color: var(--t3); }
  .rp-seg, .rp-pay { display: flex; height: 8px; margin: 4mm 0 2.4mm; border-radius: 5px; overflow: hidden; gap: 2px; }
  .rp-seg span, .rp-pay span { display: block; height: 100%; }
  .rp-segl { display: flex; flex-wrap: wrap; gap: 1mm 4mm; font-size: 6.4pt; color: var(--t2); }
  .rp-segl i { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 2px; }
  .rp-segl b { font-weight: 600; color: var(--t1); }
  .rp-slices { margin-top: 4mm; }
  .rp-slices > div { display: flex; align-items: center; gap: 2mm; padding: 1.4mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.2pt; }
  .rp-slices i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .rp-slices .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rp-slices b { font: 600 7.2pt ${monoStack}; }
  .rp-slices .p { width: 8mm; text-align: right; font-size: 6.6pt; color: var(--t3); font-variant-numeric: tabular-nums; }
  .rp-roles { display: flex; justify-content: space-between; gap: 2mm; padding-top: 1.6mm; font-size: 6.8pt; color: var(--t2); }
  .rp-roles b { color: var(--t1); font-weight: 600; }
  .rp-stkey { display: flex; flex-wrap: wrap; justify-content: center; gap: 1mm 3mm; margin-top: 2mm; font-size: 6pt; color: var(--t3); --sw: ${t.ramp[1]}; }
  .rp-stkey span { display: inline-flex; align-items: center; gap: 1.4mm; }
  .rp-st { display: inline-block; width: 10px; height: 7px; border-radius: 2px; }
  .rp-st.won { background: var(--sw); }
  .rp-st.lost { background: color-mix(in srgb, var(--sw) ${t.dark ? 50 : 34}%, transparent); }
  .rp-st.neutral { background: repeating-linear-gradient(45deg, var(--sw) 0 1.2px, color-mix(in srgb, var(--sw) 16%, transparent) 1.2px 3px); }
  .rp-st.pending { background: color-mix(in srgb, var(--sw) 16%, transparent); border: 1px dashed var(--sw); }

  .rp-res { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8mm; }
  .rp-res > div { display: flex; align-items: center; gap: 2.4mm; padding: 1.6mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.2pt; break-inside: avoid; }
  .rp-res i { width: 3px; height: 10px; border-radius: 2px; flex: none; }
  .rp-res span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .rp-res b { font-weight: 600; font-size: 7.2pt; }
  .rp-months { display: block; width: 100%; height: auto; }
  .rp-bar-v { font: 500 10px ${monoStack}; }
  .rp-bar-l { font: 500 10px ${fontStack}; }

  /* latest cases + hearings: ruled rows, no boxes */
  .rp-rows .r { display: grid; grid-template-columns: 3px minmax(0, 1fr) auto; gap: 3.2mm; align-items: center; padding: 2.2mm 0; border-bottom: .4pt solid var(--bs); break-inside: avoid; }
  .rp-rows .r > i { align-self: stretch; min-height: 20px; border-radius: 2px; }
  .rp-rows .w b { display: block; font-size: 7.6pt; overflow-wrap: anywhere; }
  .rp-rows .w span { font-size: 6.4pt; color: var(--t3); overflow-wrap: anywhere; }
  .rp-rows .am { text-align: right; }
  .rp-rows .am b { display: block; font-size: 7.4pt; font-weight: 500; white-space: nowrap; }
  .rp-rows .am span { font-size: 6.4pt; color: var(--t3); white-space: nowrap; }
  .rp-hr { display: grid; grid-template-columns: 20mm minmax(0, 1fr) auto; gap: 4mm; align-items: center; padding: 2.4mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.4pt; break-inside: avoid; }
  .rp-hr .d { font-weight: 600; }
  .rp-hr .w b { display: block; }
  .rp-hr .w span { font-size: 6.6pt; color: var(--t3); }
  .rp-hr .t { display: flex; flex-direction: column; align-items: flex-end; font-size: 6.6pt; color: var(--t2); line-height: 1.3; }
  .rp-empty { padding: 2.4mm 0; font-size: 7.4pt; color: var(--t3); }

  .rp-pl { display: flex; justify-content: space-between; gap: 4mm; font-size: 6.8pt; color: var(--t2); }
  .rp-pl b { display: block; font-size: 12pt; font-weight: 700; letter-spacing: -.02em; color: inherit; }
  .rp-pl .r { text-align: right; }
  .rp-pl > span:first-child b { color: var(--t1); }

  /* honest gaps */
  .rp-note { margin-top: 5mm; padding: 2.4mm 3.2mm; border: 1px dashed ${t.tone.warn.fg}; border-radius: 2mm; background: ${t.tone.warn.bg}; font-size: 7.2pt; break-inside: avoid; }
  `
}
