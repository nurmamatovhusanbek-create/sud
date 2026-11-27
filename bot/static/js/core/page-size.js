// How many rows a list shows per page: one choice for every list, kept on this phone (localStorage; the app works without it).
export const SIZES = [10, 30, 50, 100]
const KEY = 'pageSize'

export function pageSize() {
  try {
    const n = Number(localStorage.getItem(KEY))
    return SIZES.includes(n) ? n : 30
  } catch { return 30 }
}

export function setPageSize(n) {
  try { localStorage.setItem(KEY, String(n)) } catch { /* not allowed here: the choice lasts until the screen is left */ }
}
