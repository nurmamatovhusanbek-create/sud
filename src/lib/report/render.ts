/**
 * Company report — the design.
 *
 * Turns a ReportModel into HTML + inline SVG (no chart library, no external
 * assets) and the CSS that styles it. Pure string building, so it renders the same
 * in the print window, in a test, and in a headless PDF render.
 *
 * The look follows the app's themed PDF (src/lib/print.ts): the navy/indigo brand,
 * uppercase accent section labels with a hairline rule, zebra rows, accent-soft
 * key figures. It adapts to the app theme; charts use the same semantic tones as
 * the rest of the app (green won · rose lost · blue in progress · gray neutral).
 */

import { escapeHtml as h, palette, type Palette } from '@/lib/print'
import { formatDmy } from '@/core/dates'
import { fmtInt, REPORT_SOURCES, shortSum, type ReportModel, type Tone } from './model'

// ---- theme -------------------------------------------------------------------

export interface ReportTheme extends Palette {
  tone: Record<Tone, { fg: string; bg: string }>
  /** share-bar / donut ramp, strongest first */
  ramp: string[]
}

export function reportTheme(dark: boolean): ReportTheme {
  const p = palette(dark)
  return dark
    ? {
        ...p,
        tone: {
          pos: { fg: '#4ec08a', bg: 'rgba(78,192,138,.16)' },
          neg: { fg: '#e06a86', bg: 'rgba(224,106,134,.16)' },
          warn: { fg: '#e2a94a', bg: 'rgba(226,169,74,.16)' },
          info: { fg: '#7f9bff', bg: 'rgba(127,155,255,.16)' },
          neu: { fg: '#9aa3c7', bg: 'rgba(154,163,199,.14)' },
        },
        ramp: ['#8ea2f5', '#6d84ec', '#4d63c9', '#3d4fa6', '#2f3d80', '#26326a'],
      }
    : {
        ...p,
        tone: {
          pos: { fg: '#2f8f5b', bg: '#e6f4ec' },
          neg: { fg: '#c04a68', bg: '#fbe9ee' },
          warn: { fg: '#b7791f', bg: '#fdf3df' },
          info: { fg: '#2f5bd0', bg: '#e8eefc' },
          neu: { fg: '#6b7392', bg: '#eceef6' },
        },
        ramp: ['#1a2350', '#3b5bdb', '#6d84ec', '#a4b3f5', '#c9d2fa', '#e3e8fc'],
      }
}

// ---- SVG ---------------------------------------------------------------------

/** Half-circle score gauge; the arc is `score`% of the half turn. */
function gauge(score: number | null, tone: Tone, t: ReportTheme): string {
  const r = 54
  const len = Math.PI * r
  const arc = `M12 66 A${r} ${r} 0 0 1 120 66`
  const filled = score === null ? 0 : (len * score) / 100
  return `<svg class="rp-gauge" viewBox="0 0 132 76" role="img" aria-label="Reyting ${score ?? ''}">
    <path d="${arc}" fill="none" stroke="${t.borderSoft}" stroke-width="11" stroke-linecap="round"/>
    ${filled > 0 ? `<path d="${arc}" fill="none" stroke="${t.tone[tone].fg}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${len.toFixed(2)}"/>` : ''}
    <text x="66" y="62" text-anchor="middle" class="rp-gauge-n" fill="${t.t1}">${score === null ? '–' : Math.round(score)}</text>
  </svg>`
}

/** Ring chart. Segments with a zero value are skipped; a hairline gap separates the rest. */
function donut(segs: { value: number; color: string }[], center: string, sub: string, t: ReportTheme): string {
  const r = 44
  const c = 2 * Math.PI * r
  const total = segs.reduce((a, s) => a + s.value, 0)
  const live = segs.filter((s) => s.value > 0)
  const gap = live.length > 1 ? 1.6 : 0
  let offset = 0
  const arcs = total
    ? live
        .map((s) => {
          const seg = (s.value / total) * c
          const out = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}" stroke-width="20" stroke-dasharray="${Math.max(0, seg - gap).toFixed(2)} ${(c - Math.max(0, seg - gap)).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"/>`
          offset += seg
          return out
        })
        .join('')
    : ''
  return `<svg class="rp-donut" viewBox="0 0 120 120" role="img" aria-label="${h(center)} ${h(sub)}">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${t.borderSoft}" stroke-width="20"/>
    ${arcs}
    <text x="60" y="61" text-anchor="middle" class="rp-donut-n" fill="${t.t1}">${h(center)}</text>
    <text x="60" y="76" text-anchor="middle" class="rp-donut-s" fill="${t.t3}">${h(sub)}</text>
  </svg>`
}

/** 12 monthly bars; the current (last) month is drawn in the accent. */
function monthly(points: { label: string; count: number }[], t: ReportTheme): string {
  const max = Math.max(1, ...points.map((p) => p.count))
  const slot = 580 / points.length
  const bw = 26
  const bars = points
    .map((p, i) => {
      const x = 10 + i * slot + (slot - bw) / 2
      const hgt = p.count ? Math.max(4, (p.count / max) * 58) : 2
      const y = 84 - hgt
      const last = i === points.length - 1
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${hgt.toFixed(1)}" rx="4" fill="${last ? t.accent : p.count ? t.ramp[2] : t.borderSoft}"/>
      ${p.count ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" class="rp-bar-v" fill="${t.t2}">${p.count}</text>` : ''}
      <text x="${(x + bw / 2).toFixed(1)}" y="101" text-anchor="middle" class="rp-bar-l" fill="${last ? t.t1 : t.t3}">${h(p.label)}</text>`
    })
    .join('')
  return `<svg class="rp-months" viewBox="0 0 600 106" role="img" aria-label="Oylik faollik">
    <line x1="10" y1="84" x2="590" y2="84" stroke="${t.border}" stroke-width="1"/>${bars}</svg>`
}

const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v5c0 4.5 3.2 7.9 8 9 4.8-1.1 8-4.5 8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>`

// ---- HTML pieces -------------------------------------------------------------

const sec = (title: string, right = '') => `<div class="rp-sec"><span>${h(title)}</span>${right ? `<em>${right}</em>` : ''}</div>`

const kv = (rows: { label: string; value: string; mono?: boolean }[]) =>
  rows.length
    ? `<div class="rp-kv">${rows.map((r) => `<div><span class="k">${h(r.label)}</span><span class="v${r.mono ? ' m' : ''}">${h(r.value)}</span></div>`).join('')}</div>`
    : ''

const pill = (text: string, tone: Tone, t: ReportTheme, dot = true) =>
  `<span class="rp-pill" style="color:${t.tone[tone].fg};background:${t.tone[tone].bg}">${dot ? `<i style="background:${t.tone[tone].fg}"></i>` : ''}${h(text)}</span>`

const note = (n: { section: string; message: string }) =>
  `<div class="rp-note"><b>${h(n.section)}:</b> maʼlumot olinmadi <span>(${h(n.message)})</span></div>`

const CLASS_ROWS: { key: 'win' | 'lose' | 'inProgress' | 'neutral'; label: string; tone: Tone }[] = [
  { key: 'win', label: 'Yutgan', tone: 'pos' },
  { key: 'lose', label: 'Yutqazgan', tone: 'neg' },
  { key: 'inProgress', label: 'Jarayonda', tone: 'info' },
  { key: 'neutral', label: 'Neytral', tone: 'neu' },
]

function hero(m: ReportModel, t: ReportTheme): string {
  const r = m.rating
  return `<section class="rp-hero">
    <div class="rp-hero-l">
      <div class="rp-eyebrow">${h(m.legalForm || 'Yuridik shaxs')}</div>
      <h1>${h(m.name)}</h1>
      <div class="rp-chips">${m.status ? pill(m.status.text, m.status.tone, t) : ''}</div>
    </div>
    <div class="rp-hero-r">
      ${
        r
          ? `<div class="rp-rate">${gauge(r.score, r.tone, t)}${pill(r.category, r.tone, t, false)}<div class="rp-rate-c">Hamkor reytingi · chamber.uz</div></div>`
          : `<div class="rp-rate rp-rate-none"><div class="rp-rate-c">Reyting mavjud emas</div></div>`
      }
    </div>
  </section>
  <section class="rp-kpis">${m.kpis
    .map(
      (k) => `<div class="rp-kpi"><div class="l">${h(k.label)}</div><div class="v"${k.tone ? ` style="color:${t.tone[k.tone].fg}"` : ''}>${h(k.value)}</div>${k.sub ? `<div class="s">${h(k.sub)}</div>` : ''}</div>`,
    )
    .join('')}</section>`
}

function profile(m: ReportModel): string {
  const right = [
    m.registration.length ? `<div class="rp-block">${sec('Roʻyxatga olish')}${kv(m.registration)}</div>` : '',
    m.contacts.length ? `<div class="rp-block">${sec('Aloqa')}${kv(m.contacts)}</div>` : '',
  ].join('')
  if (!m.facts.length && !right) return ''
  return `<section class="rp-two">
    <div class="rp-block">${sec('Umumiy maʼlumot')}${kv(m.facts)}</div>
    <div>${right}</div>
  </section>
  ${m.codes.length ? `<section class="rp-block">${sec('Faoliyat kodlari')}<div class="rp-wide">${kv(m.codes)}</div></section>` : ''}`
}

function founders(m: ReportModel, t: ReportTheme): string {
  const rows = m.founders.rows
  if (!rows.length) return ''
  const known = rows.filter((f) => f.share !== null)
  const denom = Math.max(100, known.reduce((a, f) => a + (f.share as number), 0))
  const bar = known
    .map((f, i) => `<i style="width:${(((f.share as number) / denom) * 100).toFixed(2)}%;background:${t.ramp[i % t.ramp.length]}" title="${h(f.name)}"></i>`)
    .join('')
  return `<section class="rp-block rp-avoid">${sec('Taʼsischilar', m.founders.others ? `yana ${m.founders.others} ta` : '')}
    ${bar ? `<div class="rp-stack">${bar}</div>` : ''}
    <div class="rp-founders">${rows
      .map(
        (f, i) =>
          `<div><i style="background:${f.share !== null ? t.ramp[i % t.ramp.length] : t.border}"></i><span class="n">${h(f.name)}</span><span class="p">${h(f.share !== null ? `${String(f.share).replace('.', ',')}%` : f.text || '–')}</span></div>`,
      )
      .join('')}</div></section>`
}

function courts(m: ReportModel, t: ReportTheme): string {
  const c = m.cases
  if (!c) return ''
  const seg = CLASS_ROWS.map((r) => ({ value: c[r.key], color: t.tone[r.tone].fg }))
  const pct = (n: number) => (c.total ? `${(Math.round((n / c.total) * 1000) / 10).toString().replace('.', ',')}%` : '–')
  const roleTotal = Math.max(1, c.asPlaintiff + c.asDefendant)
  const courtMax = Math.max(1, ...c.byCourt.map((x) => x.count))

  return `<section class="rp-block">${sec('Sud ishlari', `jami ${fmtInt(c.total)} · joriy ${fmtInt(c.inProgress)} · yakunlangan ${fmtInt(c.decided)}`)}
    <div class="rp-court-top rp-avoid">
      <div class="rp-donut-wrap">${donut(seg, fmtInt(c.total), 'ta ish', t)}</div>
      <div class="rp-legend">${CLASS_ROWS.map(
        (r) => `<div><i style="background:${t.tone[r.tone].fg}"></i><span class="n">${r.label}</span><b>${fmtInt(c[r.key])}</b><span class="p">${pct(c[r.key])}</span></div>`,
      ).join('')}</div>
      <div class="rp-side">
        <div class="rp-mini-h">Rol</div>
        <div class="rp-stack rp-stack-s"><i style="width:${((c.asPlaintiff / roleTotal) * 100).toFixed(1)}%;background:${t.ramp[1]}"></i><i style="width:${((c.asDefendant / roleTotal) * 100).toFixed(1)}%;background:${t.ramp[3]}"></i></div>
        <div class="rp-role"><span><i style="background:${t.ramp[1]}"></i>Daʼvogar <b>${fmtInt(c.asPlaintiff)}</b></span><span><i style="background:${t.ramp[3]}"></i>Javobgar <b>${fmtInt(c.asDefendant)}</b></span></div>
        <div class="rp-mini-h" style="margin-top:12px">Sud turi boʻyicha</div>
        ${c.byCourt
          .map(
            (x) => `<div class="rp-hb"><span class="n">${h(x.label)}</span><span class="bar"><i style="width:${((x.count / courtMax) * 100).toFixed(1)}%;background:${t.ramp[1]}"></i></span><b>${fmtInt(x.count)}</b></div>`,
          )
          .join('')}
      </div>
    </div>

    ${
      c.results.length
        ? `<div class="rp-sub rp-avoid"><div class="rp-mini-h">Natijalar</div><div class="rp-results">${c.results
            .map(
              (r) =>
                `<div><span class="n">${h(r.label)}</span><span class="c">${fmtInt(r.count)}</span><span class="bar"><i style="width:${Math.min(100, r.pct)}%;background:${t.tone[r.tone].fg}"></i></span><span class="p">${String(r.pct).replace('.', ',')}%</span></div>`,
            )
            .join('')}</div></div>`
        : ''
    }

    <div class="rp-sub rp-avoid"><div class="rp-mini-h">Oylik faollik · soʻnggi 12 oy</div>${monthly(c.monthly, t)}</div>

    ${
      c.latest.length
        ? `<div class="rp-sub"><div class="rp-mini-h">Soʻnggi ishlar</div>
      <table class="rp-table"><thead><tr><th style="width:56mm">Ish</th><th>Qarshi tomon</th><th style="width:38mm">Natija</th><th class="r" style="width:22mm">Summa, soʻm</th><th style="width:21mm">Sana</th></tr></thead><tbody>${c.latest
        .map(
          (r) =>
            `<tr><td><span class="m">${h(r.number)}</span>${r.court ? `<span class="sub">${h(r.court)}</span>` : ''}</td><td><b class="role" title="${r.role === 'plaintiff' ? 'Kompaniya daʼvogar' : 'Kompaniya javobgar'}">${r.role === 'plaintiff' ? 'D' : 'J'}</b>${h(r.party || '–')}</td><td><i class="dot" style="background:${t.tone[r.tone].fg}"></i>${h(r.result || '–')}</td><td class="r m">${r.amount !== null ? h(shortSum(r.amount)) : '–'}</td><td class="m nw">${h(r.date)}</td></tr>`,
        )
        .join('')}</tbody></table>
      <div class="rp-legend-note">D — kompaniya daʼvogar, J — kompaniya javobgar</div></div>`
        : ''
    }
  </section>`
}

function hearings(m: ReportModel, t: ReportTheme): string {
  if (m.hearings === null) return ''
  return `<section class="rp-block rp-avoid">${sec('Yaqin majlislar')}${
    m.hearings.length
      ? `<div class="rp-hearings">${m.hearings
          .map(
            (x) =>
              `<div><div class="d"><b>${h(x.date)}</b>${x.time ? `<span>${h(x.time)}</span>` : ''}</div><div class="w"><b>${h(x.court || 'Sud')}</b><span>${x.caseNumber ? `Ish ${h(x.caseNumber)}` : ''}${x.judge ? ` · sudya ${h(x.judge)}` : ''}</span></div>${
                x.daysLeft !== null && x.daysLeft >= 0 ? pill(x.daysLeft === 0 ? 'Bugun' : `${x.daysLeft} kun qoldi`, x.daysLeft <= 7 ? 'warn' : 'info', t, false) : ''
              }</div>`,
          )
          .join('')}</div>`
      : `<div class="rp-empty">Belgilangan majlis yoʻq</div>`
  }</section>`
}

function bills(m: ReportModel): string {
  const b = m.bills
  if (!b) return ''
  return `<section class="rp-block rp-avoid">${sec('Toʻlovlar', `${formatDmy(b.loadedAt)} holatiga`)}
    <div class="rp-kpis rp-kpis-3">
      <div class="rp-kpi"><div class="l">Jami kvitansiya</div><div class="v">${fmtInt(b.count)}</div><div class="s">${fmtInt(b.paidCount)} tasi toʻlangan</div></div>
      <div class="rp-kpi"><div class="l">Toʻlangan</div><div class="v">${h(shortSum(b.paidTotal / 100))}</div><div class="s">soʻm</div></div>
      <div class="rp-kpi"><div class="l">Muddati oʻtgan</div><div class="v" ${b.overdueTotal > 0 ? 'data-neg' : ''}>${h(shortSum(b.overdueTotal / 100))}</div><div class="s">soʻm</div></div>
    </div></section>`
}

/** The report body (everything between the running header and footer). */
export function renderReportBody(m: ReportModel, t: ReportTheme): string {
  return [hero(m, t), profile(m), founders(m, t), bills(m), courts(m, t), hearings(m, t), m.notes.map(note).join('')].join('\n')
}

/** Running header: brand, report title, company + date. Repeats on every printed page. */
export function renderReportHeader(m: ReportModel): string {
  return `<div class="rp-head">
    <div class="rp-brand"><span class="logo">${LOGO}</span><span><b>Sud tizimi</b><small>by Nurmamatov</small></span></div>
    <div class="rp-head-r"><b>Kompaniya hisoboti</b><span>STIR ${h(m.stir)} · ${h(formatDmy(m.generatedAt))}</span></div>
  </div>`
}

/** Running footer: sources + disclaimer. */
export function renderReportFooter(): string {
  return `<div class="rp-foot"><span>Manba: ${h(REPORT_SOURCES)}. Hisobot tuzilgan paytdagi holatni aks ettiradi va rasmiy hujjat hisoblanmaydi.</span></div>`
}

// ---- CSS ---------------------------------------------------------------------

export function reportCss(t: ReportTheme, fontStack: string, monoStack: string): string {
  return `
  :root { --bg:${t.bg}; --ps:${t.surface}; --in:${t.inset}; --t1:${t.t1}; --t2:${t.t2}; --t3:${t.t3}; --bd:${t.border}; --bs:${t.borderSoft}; --a:${t.accent}; --at:${t.accentText}; --as:${t.accentSoft}; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: var(--bg); }
  body { font-family: ${fontStack}; font-size: 11.5px; line-height: 1.45; color: var(--t1); }
  .m { font-family: ${monoStack}; font-variant-numeric: tabular-nums; }

  /* page: the table's thead/tfoot repeat on every printed page */
  /* the bottom margin band holds the page number where the browser supports margin boxes
     (Chrome/Edge 131+). It MUST be painted with @page background: by default the margin band
     stays white, which shows as a bright strip in dark mode. */
  @page { size: A4; margin: 0 0 9mm; background: ${t.bg}; @bottom-right { content: counter(page) " / " counter(pages); font: 600 8.5px ${fontStack}; color: ${t.t3}; padding-right: 12mm; vertical-align: top; padding-top: 2mm; } }
  table.rp { width: 210mm; margin: 0 auto; border-collapse: collapse; }
  table.rp > thead > tr > td { padding: 9mm 12mm 5mm; }
  table.rp > tbody > tr > td { padding: 0 12mm; vertical-align: top; }
  table.rp > tfoot > tr > td { padding: 4mm 12mm 4mm; }
  @media screen { table.rp { background: var(--ps); box-shadow: 0 8px 40px rgba(20,24,52,.18); margin: 24px auto; } body { padding: 0 0 24px; } }

  /* running header */
  .rp-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--bd); position: relative; }
  .rp-head::after { content: ""; position: absolute; left: 0; bottom: -1px; width: 46px; height: 3px; border-radius: 3px; background: var(--a); }
  .rp-brand { display: flex; align-items: center; gap: 9px; }
  .rp-brand .logo { width: 28px; height: 28px; border-radius: 8px; background: var(--a); color: var(--at); display: grid; place-items: center; }
  .rp-brand .logo svg { width: 16px; height: 16px; }
  .rp-brand b { display: block; font-size: 13px; font-weight: 800; letter-spacing: -.01em; line-height: 1.1; }
  .rp-brand small { display: block; font-size: 8.5px; color: var(--t3); letter-spacing: .04em; }
  .rp-head-r { text-align: right; font-size: 10px; color: var(--t2); line-height: 1.35; }
  .rp-head-r b { display: block; font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--a); }

  /* running footer */
  .rp-foot { padding-top: 6px; border-top: 1px solid var(--bs); font-size: 8.5px; line-height: 1.4; color: var(--t3); }

  /* hero */
  .rp-hero { display: flex; justify-content: space-between; gap: 18px; padding: 16px 0 12px; }
  .rp-hero-l { flex: 1; min-width: 0; }
  .rp-eyebrow { font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--t3); }
  .rp-hero h1 { margin-top: 5px; font-size: 25px; line-height: 1.15; font-weight: 800; letter-spacing: -.02em; overflow-wrap: anywhere; }
  .rp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .rp-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
  .rp-pill i { width: 6px; height: 6px; border-radius: 50%; }
  .rp-hero-r { width: 132px; flex: none; }
  .rp-rate { text-align: center; padding: 8px 8px 9px; border: 1px solid var(--bd); border-radius: 14px; background: var(--in); }
  .rp-rate .rp-pill { margin-top: -4px; }
  .rp-rate-c { margin-top: 5px; font-size: 8.5px; color: var(--t3); line-height: 1.3; }
  .rp-rate-none { padding: 22px 8px; border-style: dashed; background: transparent; }
  .rp-gauge { display: block; width: 100%; height: auto; }
  .rp-gauge-n { font: 800 26px ${fontStack}; }

  /* KPI tiles */
  .rp-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 2px 0 6px; }
  .rp-kpis-3 { grid-template-columns: repeat(3, 1fr); }
  .rp-kpi { padding: 10px 12px; border: 1px solid var(--bd); border-radius: 12px; background: var(--as); break-inside: avoid; }
  .rp-kpi .l { font-size: 8.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--a); }
  .rp-kpi .v { margin-top: 4px; font-size: 21px; line-height: 1.1; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .rp-kpi .v[data-neg] { color: ${t.tone.neg.fg}; }
  .rp-kpi .s { margin-top: 3px; font-size: 9.5px; color: var(--t2); }

  /* section label: uppercase accent + hairline rule (same as the app's PDF) */
  .rp-sec { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 9.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--a); break-after: avoid; }
  .rp-sec::after { content: ""; order: 1; flex: 1; height: 1px; background: var(--bs); }
  .rp-sec em { order: 2; font-style: normal; font-weight: 700; letter-spacing: .02em; text-transform: none; color: var(--t3); font-size: 9.5px; }
  .rp-block { margin-top: 16px; }
  .rp-avoid { break-inside: avoid; }
  .rp-two { display: grid; grid-template-columns: 1.15fr 1fr; gap: 0 16px; }
  .rp-two .rp-block:first-child, .rp-two > div > .rp-block:first-child { margin-top: 16px; }

  /* zebra key / value rows */
  .rp-kv { border: 1px solid var(--bd); border-radius: 10px; overflow: hidden; }
  .rp-kv > div { display: grid; grid-template-columns: 34mm minmax(0, 1fr); gap: 10px; padding: 6px 10px; font-size: 10.5px; align-items: baseline; break-inside: avoid; }
  .rp-kv > div:nth-child(even) { background: var(--in); }
  .rp-kv .k { color: var(--t2); }
  .rp-kv .v { font-weight: 600; overflow-wrap: anywhere; }
  .rp-two .rp-kv > div { grid-template-columns: 29mm minmax(0, 1fr); }
  .rp-wide .rp-kv > div { grid-template-columns: 52mm minmax(0, 1fr); }

  /* founders */
  .rp-stack { display: flex; height: 11px; border-radius: 6px; overflow: hidden; gap: 2px; background: var(--bs); }
  .rp-stack i { display: block; height: 100%; }
  .rp-stack-s { height: 8px; }
  .rp-founders { margin-top: 8px; }
  .rp-founders > div { display: flex; align-items: center; gap: 9px; padding: 5px 2px; border-bottom: 1px solid var(--bs); font-size: 10.5px; }
  .rp-founders > div:last-child { border-bottom: 0; }
  .rp-founders i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .rp-founders .n { flex: 1; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
  .rp-founders .p { font-weight: 800; font-variant-numeric: tabular-nums; }

  /* court cases */
  .rp-court-top { display: grid; grid-template-columns: 36mm 1fr 58mm; gap: 14px; align-items: center; }
  .rp-donut { width: 100%; height: auto; display: block; }
  .rp-donut-n { font: 800 20px ${fontStack}; }
  .rp-donut-s { font: 500 8px ${fontStack}; letter-spacing: .04em; }
  .rp-legend > div { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--bs); font-size: 11px; }
  .rp-legend > div:last-child { border-bottom: 0; }
  .rp-legend i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .rp-legend .n { flex: 1; }
  .rp-legend b { font-variant-numeric: tabular-nums; }
  .rp-legend .p { width: 38px; text-align: right; color: var(--t3); font-variant-numeric: tabular-nums; }
  .rp-side { padding-left: 12px; border-left: 1px solid var(--bs); }
  .rp-mini-h { margin-bottom: 6px; font-size: 8.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--t3); }
  .rp-role { display: flex; justify-content: space-between; gap: 6px; margin-top: 6px; font-size: 10px; color: var(--t2); }
  .rp-role i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  .rp-role b { color: var(--t1); margin-left: 3px; }
  .rp-hb { display: grid; grid-template-columns: 19mm 1fr 18px; gap: 6px; align-items: center; margin-top: 5px; font-size: 10px; }
  .rp-hb .bar, .rp-results .bar { height: 6px; border-radius: 4px; background: var(--bs); overflow: hidden; }
  .rp-hb .bar i, .rp-results .bar i { display: block; height: 100%; border-radius: 4px; }
  .rp-hb b { text-align: right; font-variant-numeric: tabular-nums; }
  .rp-sub { margin-top: 14px; }
  .rp-results > div { display: grid; grid-template-columns: minmax(0, 1fr) 24px 32mm 40px; gap: 10px; align-items: center; padding: 4.5px 0; border-bottom: 1px solid var(--bs); font-size: 10.5px; break-inside: avoid; }
  .rp-results > div:last-child { border-bottom: 0; }
  .rp-results .c { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rp-results .p { text-align: right; color: var(--t3); font-variant-numeric: tabular-nums; }
  .rp-months { display: block; width: 100%; height: auto; }
  .rp-bar-v { font: 700 10px ${fontStack}; }
  .rp-bar-l { font: 600 9.5px ${fontStack}; }

  /* tables */
  .rp-table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; border: 1px solid var(--bd); border-radius: 10px; overflow: hidden; font-size: 9.5px; }
  .rp-table th { text-align: left; padding: 6px 8px; font-size: 8px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--at); background: var(--a); }
  .rp-table td { padding: 6px 8px; border-top: 1px solid var(--bs); vertical-align: top; overflow-wrap: anywhere; }
  .rp-table tbody tr:nth-child(even) td { background: var(--in); }
  .rp-table tr { break-inside: avoid; }
  .rp-table .r { text-align: right; }
  .rp-table .nw { white-space: nowrap; }
  .rp-table .sub { display: block; margin-top: 2px; font-size: 8.5px; color: var(--t3); }
  .rp-table .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
  .rp-table .role { display: inline-grid; place-items: center; width: 14px; height: 14px; margin-right: 6px; border-radius: 4px; background: var(--as); color: var(--a); font-size: 8px; font-weight: 800; vertical-align: 1px; }
  .rp-legend-note { margin-top: 5px; font-size: 8.5px; color: var(--t3); }

  /* hearings */
  .rp-hearings > div { display: flex; align-items: center; gap: 14px; padding: 8px 12px; margin-bottom: 6px; border: 1px solid var(--bd); border-left: 3px solid var(--a); border-radius: 10px; background: var(--in); break-inside: avoid; }
  .rp-hearings .d { width: 26mm; flex: none; }
  .rp-hearings .d b { display: block; font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rp-hearings .d span { font-size: 10px; color: var(--t2); }
  .rp-hearings .w { flex: 1; min-width: 0; }
  .rp-hearings .w b { display: block; font-size: 11px; }
  .rp-hearings .w span { font-size: 9.5px; color: var(--t2); }
  .rp-empty { padding: 10px 12px; border: 1px dashed var(--bd); border-radius: 10px; color: var(--t3); font-size: 10.5px; }

  /* honest gaps */
  .rp-note { margin-top: 12px; padding: 8px 12px; border: 1px dashed ${t.tone.warn.fg}; border-radius: 10px; background: ${t.tone.warn.bg}; color: var(--t1); font-size: 10px; break-inside: avoid; }
  .rp-note span { color: var(--t2); }
  `
}
