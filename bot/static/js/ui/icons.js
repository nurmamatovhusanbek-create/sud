import { svg } from './h.js'

const PATHS = {
  search: ['M21 21l-4.3-4.3', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z'],
  case: ['M12 3v18', 'M6 21h12', 'M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0z', 'M19 7l-3 7a3 3 0 0 0 6 0z'],
  bill: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  company: ['M4 21V5l8-2v18', 'M12 9h8v12', 'M2 21h20', 'M8 8v.01', 'M8 12v.01', 'M8 16v.01'],
  chevron: ['M9 6l6 6-6 6'],
  back: ['M15 6l-6 6 6 6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
}
export const icon = (name, size) => svg(PATHS[name] || [], size)
