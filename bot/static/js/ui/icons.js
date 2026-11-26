import { svg } from './h.js'

const PATHS = {
  search: ['M21 21l-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z'],
  case: ['M12 3v18', 'M6 21h12', 'M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0z', 'M19 7l-3 7a3 3 0 0 0 6 0z'],
  bill: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  company: ['M4 21V5l8-2v18', 'M12 9h8v12', 'M2 21h20', 'M8 8v.01', 'M8 12v.01', 'M8 16v.01'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  chevron: ['M9 6l6 6-6 6'],
  back: ['M15 6l-6 6 6 6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  shrink: ['M9 4v5H4', 'M15 4v5h5', 'M9 20v-5H4', 'M15 20v-5h5'],
}
export const icon = (name, size) => svg(PATHS[name] || [], size)

/** the app's logo (the four-segment ring), coloured by tokens (css/components/nav.css `.logo__N`) so it follows the theme */
export function logo(size = 24) {
  const s = svg(['M24.16 19L24.69 2.01A22 22 0 0 1 45.99 23.31L29 23.84A5 5 0 0 0 24.16 19Z', 'M29 24.16L42.19 24.57A18.2 18.2 0 0 1 24.57 42.19L24.16 29A5 5 0 0 0 29 24.16Z', 'M23.84 29L23.55 38.39A14.4 14.4 0 0 1 9.61 24.45L19 24.16A5 5 0 0 0 23.84 29Z', 'M19 23.84L13.41 23.67A10.6 10.6 0 0 1 23.67 13.41L23.84 19A5 5 0 0 0 19 23.84Z'], size)
  s.setAttribute('viewBox', '0 0 48 48')
  s.setAttribute('class', 'logo')
  s.setAttribute('fill', 'currentColor')
  s.setAttribute('stroke', 'none')
  s.querySelectorAll('path').forEach((p, i) => p.setAttribute('class', `logo__${i}`))
  return s
}
