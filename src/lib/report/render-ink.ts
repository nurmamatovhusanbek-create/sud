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

// ---- structure ---------------------------------------------------------------
//
//  PAGE 1   masthead (full-bleed ink band: who, status, the rating as a number over a ruler)
//           Xulosa     the four key figures
//           Taqsimot | Diqqat    the outcome board (wide)  ·  what needs attention NOW: hearings and payments (narrow)
//  THEN     Faollik | Natijalar  months beside the result wording
//           Turkum               tiles by category (when there are ≥ 2)
//           Soʻnggi ishlar       a real table with columns
//  LAST     Kompaniya maʼlumotlari   the registry facts as an appendix (three columns + owners)
// The verdict and what to do about it come first; static registry facts, which the old edition parked in a rail on every page, go last.

function masthead(m: ReportModel): string {
  const r = m.rating
  const status = m.status ? `<span class="st"><i></i>${h(m.status.text)}</span>` : ''
  const meta = [m.legalForm ? `<span>${h(m.legalForm)}</span>` : '', status, `<span class="m">STIR ${h(m.stir)}</span>`].filter(Boolean).join('<span class="sep">·</span>')
  const rating = r
    ? `<div class="rp-rate"><div class="rp-rate-k">Hamkor reytingi · ${h(r.category)}</div><div class="rp-rate-row"><div class="rp-rate-n m">${r.score === null ? '–' : Math.round(clampPct(r.score))}</div><div class="rp-rate-r">${ruler(r.score)}<div class="rp-rate-s m"><span>0</span><span>100</span></div></div></div></div>`
    : `<div class="rp-rate rp-rate-none">Reyting mavjud emas</div>`
  return `<header class="rp-mast"><div class="rp-mast-l"><div class="rp-mast-k">Kompaniya hisoboti</div><h1>${h(displayName(m.name))}</h1><div class="rp-meta">${meta}</div></div>${rating}</header>`
}

function kpis(m: ReportModel): string {
  return `<div class="rp-kpis">${m.kpis
    .map((k) => `<div class="rp-kpi"><div class="l">${h(k.label)}</div><div class="v">${figure(k.value)}</div>${k.sub ? `<div class="s">${h(k.sub)}</div>` : ''}</div>`)
    .join('')}</div>`
}

/** one strip: every case of a slice as ONE row of fills, proportional */
function strip(counts: Record<PizzaStatus, number>, size: 'lg' | 'md' | 'sm'): string {
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

/** the calendar leaf: month on an ink band, the day big; inverted when the date is close */
function leaf(date: string, near: boolean): string {
  const mt = /^(\d{1,2})\.(\d{1,2})\./.exec(date)
  if (!mt) return `<span class="rp-leaf txt m">${h(date)}</span>`
  return `<span class="rp-leaf${near ? ' near' : ''}"><i>${h(MONTHS_UZ[Number(mt[2]) - 1] ?? '')}</i><b>${h(mt[1].padStart(2, '0'))}</b></span>`
}


function distribution(m: ReportModel): string {
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
  return `<section class="rp-col">${sec('Taqsimot', `joriy ${fmtInt(c.inProgress)} · yakunlangan ${fmtInt(c.decided)}`)}
    <div class="rp-big"><b>${rate === null ? '–' : `${rate}%`}</b><span>yutuq darajasi<small>${rate === null ? 'hal qilingan ish yoʻq' : `${fmtInt(c.win + c.lose)} ta hal qilingan ishdan`}</small></span></div>
    ${strip(counts, 'lg')}<div class="rp-stats">${stats}</div>${roles}
    ${c.pie.length ? `<div class="rp-sub-h">Sud turi boʻyicha</div>${tiles(c.pie)}` : ''}</section>`
}

/** «Diqqat»: what needs the reader NOW: the coming hearings and the money */
function attention(m: ReportModel): string {
  const parts: string[] = []
  if (m.hearings !== null) {
    parts.push(
      `<div class="rp-att-h">Yaqin majlislar${m.hearings.length ? `<em>${fmtInt(m.hearings.length)}</em>` : ''}</div>${
        m.hearings.length
          ? m.hearings
              .map((x) => {
                const near = x.daysLeft !== null && x.daysLeft >= 0 && x.daysLeft <= 7
                const left = x.daysLeft !== null && x.daysLeft >= 0 ? (x.daysLeft === 0 ? 'Bugun' : x.daysLeft === 1 ? 'Ertaga' : `${x.daysLeft} kun qoldi`) : ''
                return `<div class="rp-hr">${leaf(x.date, near)}<div class="w"><b>${h(x.court || 'Sud')}</b><span>${x.caseNumber ? `Ish <span class="m">${h(x.caseNumber)}</span>` : ''}${x.judge ? ` · sudya ${h(x.judge)}` : ''}</span><span class="when">${x.time ? `<span class="m tm">${h(x.time)}</span>` : ''}${left ? `<span class="${near ? 'near' : ''}">${left}</span>` : ''}</span></div></div>`
              })
              .join('')
          : `<div class="rp-empty">Belgilangan majlis yoʻq</div>`
      }`,
    )
  }
  const b = m.bills
  if (b) {
    const paid = b.paidTotal / 100
    const over = b.overdueTotal / 100
    const bar =
      paid + over > 0
        ? `<div class="rp-strip md rp-pay">${paid > 0 ? `<i class="rp-st won" style="flex:${paid}"></i>` : ''}${over > 0 ? `<i class="rp-st neutral" style="flex:${over}"></i>` : ''}</div>`
        : ''
    parts.push(
      `<div class="rp-att-h">Toʻlovlar<em>${h(formatDmy(b.loadedAt))} holatiga</em></div>${bar}
      <div class="rp-pl"><div><b><i class="rp-st won"></i>${h(shortSum(paid))}</b><span>toʻlangan · ${fmtInt(b.paidCount)} / ${fmtInt(b.count)} kvitansiya</span></div><div><b><i class="rp-st neutral"></i>${h(shortSum(over))}</b><span>muddati oʻtgan</span></div></div>`,
    )
  }
  return parts.length ? `<aside class="rp-col rp-att">${sec('Diqqat')}${parts.join('')}</aside>` : ''
}

function activity(m: ReportModel, t: ReportTheme): string {
  const c = m.cases
  if (!c) return ''
  const results = c.results.length
    ? `<div class="rp-col">${sec('Natijalar')}<div class="rp-res">${c.results.map((r) => `<div>${mark(r.tone)}<span>${h(r.label)}</span><b class="m">${fmtInt(r.count)}</b></div>`).join('')}</div></div>`
    : ''
  return `<div class="rp-2 rp-avoid rp-block"><div class="rp-col">${sec('Oylik faollik', 'soʻnggi 12 oy')}${monthly(c.monthly, t)}</div>${results}</div>
    ${c.pieTurkum.length >= 2 ? `<div class="rp-block rp-avoid">${sec('Turkum boʻyicha')}${tiles(c.pieTurkum)}</div>` : ''}`
}

/** the latest cases as a real table: status · party · role · case number · date · amount */
function casesTable(m: ReportModel): string {
  const c = m.cases
  if (!c || !c.latest.length) return ''
  return `<div class="rp-block">${sec('Soʻnggi ishlar', `jami ${fmtInt(c.total)}`)}<table class="rp-ct"><thead><tr><th>Holat</th><th>Tomon</th><th>Rol</th><th>Ish raqami</th><th>Sana</th><th class="n">Summa</th></tr></thead><tbody>${c.latest
    .map(
      (r) =>
        `<tr><td><span class="s">${mark(r.tone)}${h(r.result || '–')}</span></td><td class="p">${h(r.party ? displayName(r.party) : '–')}</td><td>${r.role === 'plaintiff' ? 'Daʼvogar' : 'Javobgar'}</td><td class="m">${h(r.number)}</td><td class="m">${h(r.date)}</td><td class="n m">${r.amount !== null ? h(shortSum(r.amount)) : '–'}</td></tr>`,
    )
    .join('')}</tbody></table></div>`
}

/** the registry facts, last: three columns of ruled lists, then the owners with their share bars */
function appendix(m: ReportModel): string {
  const facts = m.facts.filter((f) => f.label !== 'STIR' && f.label !== 'Holat')
  const group = (title: string, rows: { label: string; value: string; mono?: boolean }[]) => railGroup(title, railDl(rows))
  const cols = [
    group('Asosiy maʼlumot', facts),
    [group('Aloqa', m.contacts), group('Roʻyxatga olish', m.registration)].join(''),
    group('Faoliyat kodlari', m.codes),
  ].filter((x) => x)
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
  if (!cols.length && !owners) return ''
  return `<div class="rp-block rp-app">${sec('Kompaniya maʼlumotlari')}<div class="rp-3">${cols.map((x) => `<div>${x}</div>`).join('')}</div>${owners ? `<div class="rp-sub-h">Taʼsischilar</div>${owners}` : ''}</div>`
}

/** The report body, in reading order (the masthead sits above the table, full-bleed). */
export function renderInkBody(m: ReportModel, t: ReportTheme): { head: string; main: string } {
  const board = distribution(m)
  const att = attention(m)
  return {
    head: masthead(m),
    main: [
      `<div class="rp-block rp-first">${sec('Xulosa')}${kpis(m)}</div>`,
      board || att ? `<div class="rp-2 rp-block${board && att ? '' : ' one'}">${board}${att}</div>` : '',
      activity(m, t),
      casesTable(m),
      appendix(m),
      m.notes.map(note).join(''),
    ].join('\n'),
  }
}

/** the logo as a quiet watermark in ONE ink: the mark's «tile» variant (white at four steps of opacity) recoloured to the page's ink */
export function renderInkWatermark(t: ReportTheme): string {
  return `<div class="rp-wm" aria-hidden="true">${brandMarkSvg('tile').replaceAll('#ffffff', t.t1)}</div>`
}

// ---- CSS ---------------------------------------------------------------------

export function inkCss(t: ReportTheme, fontStack: string, monoStack: string): string {
  const ink = t.t1
  return `
  :root { --bg:${t.surface}; --t1:${t.t1}; --t2:${t.t2}; --t3:${t.t3}; --bd:${t.border}; --bs:${t.borderSoft}; --ink:${ink}; --paper:${t.surface}; --inset:${t.inset}; --mast:${t.rail.bg}; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { background: var(--bg); }
  body { font-family: ${fontStack}; font-size: 8.4pt; line-height: 1.45; -webkit-font-smoothing: antialiased; color: var(--t1); }
  b, strong { font-weight: 600; }
  .m { font-family: ${monoStack}; font-variant-numeric: tabular-nums; }

  @page { size: A4; margin: 0 0 12mm; background: ${t.surface};
    @bottom-right { content: counter(page) " / " counter(pages); font: 500 7.5pt ${monoStack}; color: ${t.t3}; padding-right: 14mm; vertical-align: top; padding-top: 3mm; } }

  .rp-sheet { position: relative; isolation: isolate; width: 210mm; margin: 0 auto; }
  .rp-foot { position: absolute; bottom: 4mm; left: 14mm; right: 28mm; display: flex; gap: 6mm; font-size: 6.4pt; line-height: 1.3; color: var(--t3); }
  .rp-foot .m { color: var(--t2); }
  .rp-wm { position: absolute; z-index: -1; right: -20mm; bottom: -14mm; width: 88mm; opacity: ${t.dark ? 0.06 : 0.045}; pointer-events: none; }
  .rp-wm svg { display: block; width: 100%; height: auto; }
  @media print { .rp-foot, .rp-wm { position: fixed; } .rp-sheet { margin: 0; } }
  @media screen { .rp-sheet { overflow: hidden; background: var(--bg); box-shadow: 0 8px 40px rgba(0,0,0,.16); margin: 24px auto; min-height: 297mm; } body { padding-bottom: 24px; } html { background: ${t.dark ? t.bg : '#ECECEE'}; } }

  /* masthead: one full-bleed ink band on page 1 only: who, status, the rating as a number over a ruler */
  .rp-mast { display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; padding: 13mm 14mm 9mm; background: var(--mast); color: #fff; }
  .rp-mast-l { min-width: 0; flex: 1; }
  .rp-mast-k { font-size: 7pt; font-weight: 500; color: rgba(255,255,255,.6); }
  .rp-mast h1 { margin: 2mm 0 3mm; font-size: 21pt; line-height: 1.15; font-weight: 600; letter-spacing: -.015em; overflow-wrap: anywhere; }
  .rp-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 2.4mm; font-size: 7.6pt; color: rgba(255,255,255,.78); }
  .rp-meta .sep { opacity: .5; }
  .rp-meta .st i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: #fff; }
  .rp-rate { flex: none; width: 66mm; }
  .rp-rate-k { font-size: 6.8pt; color: rgba(255,255,255,.6); }
  .rp-rate-row { display: flex; align-items: flex-end; gap: 4mm; margin-top: 1.4mm; }
  .rp-rate-n { font-size: 36pt; line-height: .9; font-weight: 600; letter-spacing: -.04em; }
  .rp-rate-r { flex: 1; padding-bottom: .6mm; }
  .rp-ruler { display: block; width: 100%; height: auto; }
  .rp-rate-s { display: flex; justify-content: space-between; margin-top: .8mm; font-size: 5.8pt; color: rgba(255,255,255,.5); }
  .rp-rate-none { padding-bottom: 1mm; font-size: 7pt; color: rgba(255,255,255,.6); }

  table.rp { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td.b { padding: 0 14mm; vertical-align: top; }
  thead td { height: 9mm; }
  tfoot td { height: 12mm; }

  /* the four outcomes, ONE ink: solid · tint · hatch · dashed outline */
  .rp-st { --sw: var(--ink); display: inline-block; flex: none; }
  .rp-st.won { background: var(--sw); }
  .rp-st.lost { background: color-mix(in srgb, var(--sw) ${t.dark ? 50 : 34}%, transparent); }
  .rp-st.neutral { background: repeating-linear-gradient(45deg, var(--sw) 0 1.2px, color-mix(in srgb, var(--sw) 14%, transparent) 1.2px 3px); }
  .rp-st.pending { background: transparent; border: 1px dashed var(--sw); }

  .rp-block { margin-top: 8mm; }
  .rp-first { margin-top: 0; }
  .rp-avoid { break-inside: avoid; }
  .rp-sh { display: flex; align-items: center; gap: 3mm; margin-bottom: 3.6mm; font-size: 8.6pt; font-weight: 600; break-after: avoid; }
  .rp-sh::after { content: ""; order: 1; flex: 1; height: .5pt; background: var(--bd); }
  .rp-sh em { order: 2; font-style: normal; font-weight: 400; font-size: 6.6pt; color: var(--t3); }
  .rp-sub-h { margin: 6mm 0 2.4mm; font-size: 6.8pt; font-weight: 500; color: var(--t3); }

  /* Xulosa */
  .rp-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 6mm; }
  .rp-kpi { break-inside: avoid; padding-top: 2.4mm; border-top: 1.4pt solid var(--ink); }
  .rp-kpi .l { font-size: 6.8pt; font-weight: 500; color: var(--t2); }
  .rp-kpi .v { margin-top: 1.6mm; font: 600 22pt ${monoStack}; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rp-kpi .v small { margin-left: 1mm; font-size: 7.6pt; font-weight: 500; letter-spacing: 0; color: var(--t3); }
  .rp-kpi .s { margin-top: 1.6mm; font-size: 6.2pt; line-height: 1.35; color: var(--t3); }

  /* two columns: the board (wide) beside what needs attention (narrow) */
  .rp-2 { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 9mm; align-items: start; }
  .rp-2.one { grid-template-columns: minmax(0, 1fr); }
  .rp-2 > .rp-col { min-width: 0; }
  .rp-att { padding-left: 7mm; border-left: .5pt solid var(--bd); }
  .rp-att-h { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 2.4mm; font-size: 7pt; font-weight: 500; color: var(--t2); }
  .rp-att-h em { font-style: normal; font: 400 6.4pt ${monoStack}; color: var(--t3); }
  .rp-att-h:not(:first-child) { margin-top: 6mm; }

  /* outcome board */
  .rp-big { margin-bottom: 4mm; }
  .rp-big b { display: block; font: 600 46pt ${monoStack}; line-height: .9; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
  .rp-big span { display: block; margin-top: 2.4mm; font-size: 7.4pt; font-weight: 500; color: var(--t2); }
  .rp-big small { display: block; margin-top: .6mm; font-size: 6.4pt; font-weight: 400; color: var(--t3); }
  .rp-strip { display: flex; gap: 1.2px; width: 100%; }
  .rp-strip i { display: block; height: 100%; min-width: 2px; border-radius: 2px; }
  .rp-strip.lg { height: 12mm; }
  .rp-strip.lg i { border-radius: 2.2mm; }
  .rp-strip.md { height: 5mm; }
  .rp-strip.sm { height: 2.6mm; }
  .rp-strip i.empty { flex: 1; background: var(--bs); }
  .rp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3mm; margin-top: 3.6mm; }
  .rp-stat { padding-top: 2mm; border-top: .5pt solid var(--bd); }
  .rp-stat.zero { opacity: .5; }
  .rp-stat .h { display: flex; align-items: center; gap: 1.6mm; font-size: 6.4pt; color: var(--t2); }
  .rp-stat .h i { width: 10px; height: 7px; border-radius: 2px; }
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

  /* attention: hearings + payments */
  .rp-hr { display: grid; grid-template-columns: 11mm minmax(0, 1fr); gap: 3.4mm; align-items: start; padding: 2.2mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.4pt; break-inside: avoid; }
  .rp-hr .w b { display: block; }
  .rp-hr .w > span { display: block; font-size: 6.4pt; color: var(--t3); overflow-wrap: anywhere; }
  .rp-hr .when { display: flex; align-items: baseline; gap: 3.2mm; margin-top: .6mm; }
  .rp-hr .when .tm { font-size: 8pt; font-weight: 600; color: var(--t1); }
  .rp-hr .when .near { font-weight: 600; color: var(--t1); }
  .rp-leaf { display: inline-flex; flex-direction: column; width: 11mm; height: 12.6mm; border: .6pt solid var(--ink); border-radius: 1.8mm; overflow: hidden; background: var(--paper); }
  .rp-leaf i { display: grid; place-items: center; height: 3.6mm; font-style: normal; font-size: 5.6pt; font-weight: 600; background: var(--ink); color: var(--paper); }
  .rp-leaf b { flex: 1; display: grid; place-items: center; font: 600 11pt ${monoStack}; color: var(--ink); }
  .rp-leaf.near b { background: var(--ink); color: var(--paper); }
  .rp-leaf.near i { background: var(--paper); color: var(--ink); }
  .rp-leaf.txt { width: auto; padding: 0 1mm; font-size: 6.6pt; align-items: center; justify-content: center; }
  .rp-empty { padding: 1.6mm 0; font-size: 7.4pt; color: var(--t3); }
  .rp-pay { margin: 0 0 3mm; }
  .rp-pl { display: grid; gap: 2.4mm; font-size: 6.6pt; color: var(--t3); }
  .rp-pl b { display: flex; align-items: center; gap: 1.6mm; font: 600 12pt ${monoStack}; letter-spacing: -.02em; color: var(--t1); }
  .rp-pl b i { width: 10px; height: 7px; border-radius: 2px; }

  /* activity: months beside the result wording */
  .rp-res > div { display: flex; align-items: center; gap: 2.4mm; padding: 1.6mm 0; border-bottom: .4pt solid var(--bs); font-size: 7.2pt; break-inside: avoid; }
  .rp-res i { width: 10px; height: 7px; border-radius: 2px; flex: none; }
  .rp-res span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .rp-res b { font-weight: 600; font-size: 7.2pt; }
  .rp-months { display: block; width: 100%; height: auto; }
  .rp-bar-v { font: 500 10px ${monoStack}; }
  .rp-bar-l { font: 500 10px ${fontStack}; }

  /* latest cases: a table with columns */
  table.rp-ct { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 7.2pt; }
  .rp-ct th:nth-child(1) { width: 46mm; }
  .rp-ct th { padding: 0 2mm 1.6mm 0; text-align: left; font-size: 6.2pt; font-weight: 500; color: var(--t3); border-bottom: .8pt solid var(--ink); }
  .rp-ct th.n, .rp-ct td.n { text-align: right; padding-right: 0; }
  .rp-ct td { padding: 2.2mm 2mm 2.2mm 0; border-bottom: .4pt solid var(--bs); vertical-align: middle; overflow-wrap: anywhere; }
  .rp-ct tr { break-inside: avoid; }
  .rp-ct td.p { font-weight: 600; }
  .rp-ct td.m { font-size: 6.8pt; }
  .rp-ct .s { display: inline-flex; align-items: center; gap: 2mm; }
  .rp-ct .s i { width: 10px; height: 7px; border-radius: 2px; }
  .rp-ct th:nth-child(3) { width: 16mm; } .rp-ct th:nth-child(4) { width: 34mm; } .rp-ct th:nth-child(5) { width: 19mm; } .rp-ct th:nth-child(6) { width: 22mm; }

  /* appendix: the registry facts */
  .rp-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 8mm; }
  .rp-rg { break-inside: avoid; margin-bottom: 4mm; }
  .rp-rg h3 { margin-bottom: 2mm; font-size: 7pt; font-weight: 600; }
  .rp-rg dl > div { padding: 1.4mm 0; border-bottom: .4pt solid var(--bs); break-inside: avoid; }
  .rp-rg dt { font-size: 6pt; color: var(--t3); }
  .rp-rg dd { font-size: 7.4pt; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
  .rp-rg dd.m { font-size: 7pt; }
  .rp-own { display: grid; grid-template-columns: 1fr 1fr; gap: 2.4mm 8mm; }
  .rp-own > div { font-size: 7.2pt; line-height: 1.25; break-inside: avoid; }
  .rp-own .r { display: flex; justify-content: space-between; gap: 3mm; }
  .rp-own .r b { font-weight: 500; overflow-wrap: anywhere; }
  .rp-own .r span { flex: none; font-size: 6.8pt; color: var(--t2); }
  .rp-own .bar { height: 2px; margin-top: 1.1mm; border-radius: 1px; background: var(--bs); }
  .rp-own .bar i { display: block; height: 100%; border-radius: 1px; background: var(--ink); }
  .rp-own .more { font-size: 6.4pt; color: var(--t3); }

  /* honest gaps */
  .rp-note { margin-top: 5mm; padding: 2.4mm 3.2mm; border: 1px dashed var(--ink); border-radius: 2mm; background: var(--inset); font-size: 7.2pt; break-inside: avoid; }
  `
}

/** The whole document: masthead above one table whose thead / tfoot reserve the page margins, pinned footer, watermark. */
export function renderInkDoc(m: ReportModel, o: { dark: boolean; title: string; stack: string; mono: string; fontFaceCss?: string }): string {
  const t = inkTheme(o.dark)
  const body = renderInkBody(m, t)
  return `<!doctype html><html lang="uz" data-theme="${o.dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(o.title)}</title><style>${o.fontFaceCss ?? ''}${inkCss(t, o.stack, o.mono)}</style></head><body>
<div class="rp-sheet">
${renderInkWatermark(t)}
<div class="rp-foot"><span class="m">STIR ${h(m.stir)} · ${h(formatDmy(m.generatedAt))}</span><span>Hisobot tuzilgan paytdagi holatni aks ettiradi va rasmiy hujjat hisoblanmaydi.</span></div>
${body.head}
<table class="rp">
<thead><tr><td class="b"></td></tr></thead>
<tbody><tr><td class="b rp-main">${body.main}</td></tr></tbody>
<tfoot><tr><td class="b"></td></tr></tfoot>
</table>
</div>
</body></html>`
}
