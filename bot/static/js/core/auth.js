// Telegram opens a Mini App with the SIGNED launch data in the URL fragment (`#tgWebAppData=…`). It is sent with every call and the server
// checks the signature and the person. There is no external script: nothing here talks to Telegram's servers.
const hash = new URLSearchParams(location.hash.slice(1))

export const initData = hash.get('tgWebAppData') || ''
export const launched = initData !== ''

/** `light` | `dark` from Telegram's theme (its background colour), else from the system */
export function themeName() {
  try {
    const t = JSON.parse(hash.get('tgWebAppThemeParams') || '{}')
    if (t.bg_color) return parseInt(t.bg_color.slice(1), 16) > 0x808080 ? 'light' : 'dark'
  } catch { /* fall through */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** a chat button opens `/app?case=…` / `?bill=…` / `?company=…` */
export function launchRoute() {
  const sp = new URLSearchParams(location.search)
  if (sp.get('case')) return { name: 'case', key: sp.get('case') }
  if (sp.get('bill')) return { name: 'bill', key: sp.get('bill') }
  if (sp.get('company')) return { name: 'company', key: sp.get('company') }
  return { name: 'home' }
}
