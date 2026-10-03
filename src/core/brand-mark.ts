/**
 * The Sud tizimi mark — «Hukm».
 *
 * Four wedges of 90°, each with its own radius (22 · 18,2 · 14,4 · 10,6 on a 48 grid), stacked
 * around an open hub: the app's radial stack (the Statistika pizza) as a growing spiral. The only
 * source of the shape: the sidebar, drawer, print header, report and `public/logo.svg` all draw it
 * from here, so the mark can never drift (core/__tests__/brand-mark.test.ts also checks that the
 * committed favicon file equals `FAVICON_SVG`).
 *
 * Variants are fixed paints from the design tokens: `light` on white, `dark` on navy, `tile` on the
 * brand-gradient tile (white at four steps of opacity). Pure: no DOM, no React.
 */

export type BrandVariant = 'light' | 'dark' | 'tile'

const GRID = 48
const HUB = 5
const RADII = [22, 18.2, 14.4, 10.6] as const
const GAP_DEG = 1.8

const f = (n: number): string => String(+n.toFixed(2))
const pt = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [GRID / 2 + r * Math.cos(a), GRID / 2 + r * Math.sin(a)]
}

/** one wedge path between two angles (degrees, 0 = 3 o'clock, clockwise) */
function wedge(a0: number, a1: number, r1: number): string {
  const [x0, y0] = pt(HUB, a0)
  const [x1, y1] = pt(r1, a0)
  const [x2, y2] = pt(r1, a1)
  const [x3, y3] = pt(HUB, a1)
  return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}A${r1} ${r1} 0 0 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${HUB} ${HUB} 0 0 0 ${f(x0)} ${f(y0)}Z`
}

/** the four wedge paths, outermost (navy) first */
export const BRAND_PATHS: readonly string[] = RADII.map((r, i) => wedge(-90 + 90 * i + GAP_DEG, 90 * i - GAP_DEG, r))

export interface BrandPaint {
  fill: string
  opacity?: number
}

/** `light`/`dark` use the app tokens (navy · brand-600 · brand-400 · brand-300 / light navy ramp); `tile` is white steps */
export const BRAND_PAINT: Record<BrandVariant, readonly BrandPaint[]> = {
  light: [{ fill: '#1a2350' }, { fill: '#3b5bdb' }, { fill: '#6d84ec' }, { fill: '#aab3d8' }],
  dark: [{ fill: '#eef1fd' }, { fill: '#6d84ec' }, { fill: '#aab3d8' }, { fill: '#5a68a8' }],
  tile: [{ fill: '#ffffff' }, { fill: '#ffffff', opacity: 0.82 }, { fill: '#ffffff', opacity: 0.64 }, { fill: '#ffffff', opacity: 0.46 }],
}

/** the mark as an `<svg>` string (print documents, tests); `size` in px, omit to let CSS size it */
export function brandMarkSvg(variant: BrandVariant = 'light', size?: number): string {
  const dim = size ? ` width="${size}" height="${size}"` : ''
  const paths = BRAND_PATHS.map((d, i) => {
    const p = BRAND_PAINT[variant][i]
    return `<path d="${d}" fill="${p.fill}"${p.opacity ? ` fill-opacity="${p.opacity}"` : ''}/>`
  }).join('')
  return `<svg viewBox="0 0 ${GRID} ${GRID}"${dim} aria-hidden="true">${paths}</svg>`
}

/** `public/logo.svg`: the favicon. Light paint, swapped for the dark one by the browser's colour scheme. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}"><style>${BRAND_PAINT.light.map((p, i) => `.w${i}{fill:${p.fill}}`).join('')}@media (prefers-color-scheme:dark){${BRAND_PAINT.dark.map((p, i) => `.w${i}{fill:${p.fill}}`).join('')}}</style>${BRAND_PATHS.map((d, i) => `<path class="w${i}" d="${d}"/>`).join('')}</svg>\n`
