/**
 * Fonts for the print window.
 *
 * The report opens in a fresh window that does not inherit the app's web fonts,
 * so without this it silently falls back to the system font. next/font serves the
 * app's typefaces as self-hosted @font-face rules (with hashed family names and
 * relative URLs); we copy those rules into the report, with absolute URLs, and hand
 * back the family names to put first in the font stack.
 */

export interface FontRule {
  cssText: string
  /** the rule's font-family, as written (may be quoted) */
  family: string
  /**
   * The URL of the stylesheet the rule came from. Relative font URLs are relative to
   * THAT, not to the page: in dev, Turbopack writes `url(../media/x.woff2)`, which only
   * resolves correctly against `/_next/static/chunks/…css`. Resolving against the page
   * gave `/media/x.woff2` — a 404 that also left `document.fonts.ready` hanging.
   */
  base?: string
}

export interface FontKit {
  css: string
  sans: string
  mono: string
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '')
const quote = (s: string) => `"${unquote(s)}"`

/** Pure: pick the app's two typefaces out of a list of @font-face rules and make their URLs absolute. */
export function fontKitFromRules(rules: FontRule[], fallbackBase: string): FontKit {
  const kept = rules.filter((r) => /jakarta|plex/i.test(r.family))
  const absolute = (css: string, base: string) =>
    css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _q: string, u: string) => {
      if (/^(data:|https?:|blob:)/i.test(u)) return whole
      try {
        return `url("${new URL(u, base).href}")`
      } catch {
        return whole
      }
    })
  const families = (re: RegExp) => [...new Set(kept.filter((r) => re.test(r.family)).map((r) => quote(r.family)))]
  return {
    css: kept.map((r) => absolute(r.cssText, r.base || fallbackBase)).join('\n'),
    sans: families(/jakarta/i).join(', '),
    mono: families(/plex/i).join(', '),
  }
}

/** Browser: read the app's own @font-face rules. Never throws — the report just uses system fonts. */
export function collectFontKit(): FontKit {
  const empty: FontKit = { css: '', sans: '', mono: '' }
  if (typeof document === 'undefined') return empty
  try {
    const rules: FontRule[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList
      try {
        list = sheet.cssRules
      } catch {
        continue // a cross-origin stylesheet: unreadable, and not ours
      }
      for (const r of Array.from(list)) {
        if (typeof CSSFontFaceRule !== 'undefined' && r instanceof CSSFontFaceRule) {
          rules.push({ cssText: r.cssText, family: r.style.getPropertyValue('font-family'), base: sheet.href || undefined })
        }
      }
    }
    return fontKitFromRules(rules, document.baseURI)
  } catch {
    return empty
  }
}
