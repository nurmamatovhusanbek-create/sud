// The living design system: every token with its resolved value, and every component with sample data, drawn from the SAME css and kit the Mini App uses.
// Open /static/styleguide.html. A token that exists in css/tokens/ and is missing from GROUPS fails a test (bot/src/tests.rs › the_style_guide_lists_every_token).
import { h } from './ui/h.js'
import { Bars, Button, Callout, Card, CardRow, Chips, Columns, Empty, ErrorBox, Field, Hero, Kv, List, Parties, Row, SectionLabel, Skeletons, Stats, Status, TabBar, Tabs, Timeline } from './ui/components.js'
import { logo } from './ui/icons.js'

const RAMP = [0, 25, 50, 100, 150, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((n) => `--ramp-${n}`)
const GROUPS = [
  ['Look: neutral ramp (the spine; the dark theme reverses it under the same names)', RAMP],
  ['Look: brand and signals', ['--brand', '--brand-ink', '--brand-soft', '--brand-line', '--brand-tile-from', '--brand-tile-to', '--signal-positive', '--signal-positive-ink', '--signal-positive-soft', '--signal-positive-line', '--signal-negative', '--signal-negative-ink', '--signal-negative-soft', '--signal-negative-line', '--white', '--line-1', '--line-2', '--line-3', '--canvas', '--scrim', '--hover', '--press', '--focus-ring', '--logo-0', '--logo-1', '--logo-2', '--logo-3']],
  ['Roles: surfaces and text', ['--bg-canvas', '--surface', '--surface-inset', '--surface-hover', '--surface-active', '--scrim-overlay', '--text-1', '--text-2', '--text-3', '--text-inverse']],
  ['Roles: lines, focus, action', ['--border-subtle', '--border-default', '--border-strong', '--border-focus', '--ring', '--accent', '--accent-contrast', '--accent-soft', '--brand-tile', '--on-brand-tile']],
  ['Roles: status', ['--status-positive-solid', '--status-positive-soft', '--status-positive-text', '--status-positive-line', '--status-negative-solid', '--status-negative-soft', '--status-negative-text', '--status-negative-line', '--status-info-solid', '--status-info-soft', '--status-info-text', '--status-info-line', '--status-neutral-solid', '--status-neutral-soft', '--status-neutral-text', '--status-neutral-line']],
]
const SPACE = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8']
const RADIUS = ['--radius-1', '--radius-2', '--radius-3', '--radius-pill']
const TYPE = ['--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-hero']
const OTHER = ['--border-width', '--border-width-strong', '--font-sans', '--font-mono', '--leading-tight', '--leading-body', '--weight-regular', '--weight-medium', '--weight-strong', '--duration-fast', '--duration-base', '--ease-out', '--size-tap', '--size-control', '--size-control-sm', '--size-tabbar', '--size-content', '--size-dot', '--z-sticky', '--z-bar']

const value = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function swatch(name) {
  const chip = h('span', { class: 'sg__chip' })
  chip.style.background = `var(${name})`
  const v = h('span', { class: 'sg__val' }, value(name))
  return h('div', { class: 'sg__swatch', 'data-token': name }, chip, h('span', {}, h('div', { class: 'sg__name' }, name), v))
}

function section(title, ...kids) {
  return h('section', {}, h('h2', {}, title), ...kids)
}

function build() {
  const root = document.getElementById('sg')
  const theme = document.documentElement
  const toggle = Button({ label: 'Qorongʻi / yorugʻ', size: 'small', onClick: () => { theme.dataset.theme = theme.dataset.theme === 'dark' ? 'light' : 'dark'; build() } })
  root.replaceChildren(
    h('div', { class: 'sg__bar' }, h('h1', {}, 'Sud tizimi: dizayn tizimi'), h('span', { class: 'cluster' }, logo(32), toggle)),
    h('p', { class: 'muted small' }, 'Uch bosqich: primitivlar (oʻlchamlar) → look (navy palitra, bitta fayl) → rollar (nima uchun). Komponentlar faqat rollarni oʻqiydi.'),
    ...GROUPS.map(([title, names]) => section(title, h('div', { class: 'sg__grid' }, ...names.map(swatch)))),
    section('Space', h('div', { class: 'stack' }, ...SPACE.map((n) => { const bar = h('div', { class: 'sg__bar-space' }); bar.style.width = `var(${n})`; return h('div', { class: 'cluster' }, bar, h('span', { class: 'sg__name' }, n), h('span', { class: 'sg__val' }, value(n))) }))),
    section('Radius', h('div', { class: 'cluster' }, ...RADIUS.map((n) => { const b = h('div', { class: 'sg__radius' }); b.style.borderRadius = `var(${n})`; return h('div', {}, b, h('div', { class: 'sg__name' }, n), h('div', { class: 'sg__val' }, value(n))) }))),
    section('Type', h('div', { class: 'stack' }, ...TYPE.map((n) => { const p = h('p', { class: 'sg__type' }, `Sud ishi 2-1004-2503/8020 · ${n}`); p.style.fontSize = `var(${n})`; return p }))),
    section('Other tokens', h('div', { class: 'sg__grid' }, ...OTHER.map((n) => h('div', { class: 'sg__swatch', 'data-token': n }, h('span', {}, h('div', { class: 'sg__name' }, n), h('span', { class: 'sg__val' }, value(n))))))),
    section('Surfaces', h('div', { class: 'sg__frame' },
      Hero({ caption: 'Kompaniya · STIR 207275139', id: 'ANOR TEXTILE MChJ', line: 'Birinchi yuklash 20.03.2026', name: true }),
      Stats(['3 206', 'ish'], ['84 317', 'toʻlov'], ['6', 'yil']),
      Card({ title: 'Umumiy' }, Kv('Turi', 'Fuqarolik'), Kv('Sud', 'Toshkent sudi')),
      SectionLabel('Section label'))),
    section('List and row', h('div', { class: 'sg__frame' }, List(Row({ icon: 'case', title: '2-1004-2503/8020', tag: '10:00', sub: 'Fuqarolik · 1-instansiya', sub2: 'Javobgar · qarshi tomon: Universal Savdo MChJ', onOpen() {} }), Row({ icon: 'bill', title: '260880770031', sub: 'Pochta · 2 060 000 soʻm', onOpen() {} })))),
    section('Controls', h('div', { class: 'sg__frame' },
      h('div', { class: 'cluster' }, Button({ label: 'Primary', variant: 'primary' }), Button({ label: 'Default' }), Button({ label: 'Small', size: 'small' })),
      Field({ placeholder: 'Ish raqami yoki tomon…', onInput() {} }).el,
      Chips([{ value: 1, label: 'Bugun · 4' }, { value: 7, label: '7 kun · 28' }, { value: 14, label: '14 kun · 56' }], 7, () => {}),
      Tabs([{ value: 'a', label: 'Umumiy' }, { value: 'b', label: 'Ishlar' }, { value: 'c', label: 'Toʻlovlar' }], 'a', () => {}),
      CardRow([{ value: '', title: 'Hammasi', big: '56', sub: '3 kompaniya' }, { value: 'a', title: 'ANOR TEXTILE', big: '19', sub: 'birinchi: Bugun 9:00' }], '', () => {}))),
    section('Status', h('div', { class: 'sg__frame' }, h('div', { class: 'cluster' }, Status('done', 'Yakunlangan'), Status('live', 'Koʻrib chiqilmoqda'), Status('hold', 'Toʻxtatilgan'), Status('bad', 'Muddati oʻtgan'), Status('void', 'Bekor qilingan')))),
    section('Charts', h('div', { class: 'sg__frame' }, Bars([{ label: 'Fuqarolik', value: 2100 }, { label: 'Iqtisodiy', value: 900 }, { label: 'Maʼmuriy', value: 206 }]), Columns([{ label: 2022, a: 410 }, { label: 2023, a: 900 }, { label: 2024, a: 1100 }, { label: 2025, a: 560 }]))),
    section('Case', h('div', { class: 'sg__frame' }, Callout('Navbatdagi majlis', '15.12.2030 11:30', '1-instansiya'), Parties({ role: 'Daʼvogar', name: 'Universal Savdo MChJ', tin: '201234567' }, { role: 'Javobgar', name: 'ANOR TEXTILE MChJ', tin: '207275139', mine: true }), Timeline([h('div', {}, '01.04.2025 10:00'), h('div', {}, '15.12.2030 11:30')]))),
    section('Feedback', h('div', { class: 'sg__frame' }, Empty('Bu filtr boʻyicha majlis yoʻq.'), ErrorBox('Serverga ulanib boʻlmadi', () => {}), Skeletons(2))),
    section('Bottom bar', h('div', { class: 'sg__frame cluster' }, ...TabBar([{ value: 'h', label: 'Majlislar', icon: 'calendar' }, { value: 'b', label: 'Toʻlovlar', icon: 'bill' }, { value: 'c', label: 'Kompaniyalar', icon: 'company' }], 'h', () => {}))),
  )
}

build()
