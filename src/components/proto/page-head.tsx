'use client'

/**
 * A page's title block. The classic and new looks open a page with an eyebrow, a big title and a sentence. The green
 * look already names the page in its top bar (title + tagline), so repeating it would say everything twice: there the
 * block is left out, unless the page has a title of its own that the top bar does not carry (`own`), which becomes a
 * compact heading with its sentence under it.
 */

import { useUiVersion } from '@/lib/ui-version'

export function PageHead({ eyebrow, title, desc, own, gap = 18 }: { eyebrow: string; title: string; desc: string; own?: boolean; gap?: number }) {
  if (useUiVersion() === 'green') {
    return own ? (
      <div className="gx-lead">
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    ) : null
  }
  return (
    <div className="hero" style={{ marginBottom: gap }}>
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{desc}</p>
    </div>
  )
}
