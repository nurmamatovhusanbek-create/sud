/**
 * Which interface the operator sees. Three complete looks ship side by side:
 *   'new'     — «Ixcham»: denser lists, collapsible ink sidebar, gradient accent (app/ui-new.css)
 *   'green'   — «Yashil»: a bento dashboard on a framed panel, forest green + lime (app/ui-green.css, components/greenui/*).
 *               Built fresh: it shares the new look's SCREEN STRUCTURE (tables, agenda) but none of its CSS
 *   'classic' — the v18 look exactly as it was (globals.css + prototype.css alone)
 * The choice is one attribute on <html> (`data-ui`); every rule of a look is scoped under its own
 * `[data-ui='…']`, so switching removes it completely. Chosen in Settings › Koʻrinish.
 */
export type UiVersion = 'new' | 'green' | 'classic'

export const UI_VERSIONS: readonly UiVersion[] = ['new', 'green', 'classic']
export const DEFAULT_UI: UiVersion = 'new'
/** localStorage key (per browser, like the theme). */
export const UI_STORAGE_KEY = 'sud-ui'
/** localStorage key: the new look's sidebar is collapsed to an icon rail ('1') or not. */
export const SIDE_MINI_KEY = 'sud-side-mini'

/** Anything that is not a known version (missing, edited by hand, from an older build) reads as the default. */
export function parseUiVersion(raw: unknown): UiVersion {
  return raw === 'classic' || raw === 'new' || raw === 'green' ? raw : DEFAULT_UI
}

/** The screens that were rebuilt where the classic structure was the problem (tables, agenda): every look but the classic one. */
export const usesRebuiltScreens = (ui: UiVersion): boolean => ui !== 'classic'

/**
 * Runs in <head> before the first paint, so the page never flashes the other look. Kept as a string because it is
 * inlined into the document (the CSP allows same-document inline scripts; nothing is fetched). The storage key is
 * spelled out so the repo map (`bun run map`) lists this file as a reader of it.
 */
export const UI_BOOT_SCRIPT =
  "try{var d=document.documentElement,u=localStorage.getItem('sud-ui');d.setAttribute('data-ui',u==='classic'||u==='green'?u:'new');" +
  "var t=localStorage.getItem('theme')==='dark'?'dark':'light';d.setAttribute('data-theme',t);d.style.colorScheme=t;" +
  "if(localStorage.getItem('sud-side-mini')==='1')d.setAttribute('data-side','mini')}catch(e){}"
