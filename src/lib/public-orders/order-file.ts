/**
 * Order file download with public.sud.uz's captcha token (pure: the network is injected, so it is tested without one).
 *
 * The token is single-use and may be tied to who asked for it, so ONE route mints it AND sends the download, unhedged.
 * Routes, in order: this machine itself (as a browser on public.sud.uz: same IP, same Origin), then up to two different
 * Cloudflare workers. A refused token moves on to the next route; any other failure stops (a second captcha would be
 * spent for nothing). The error says which routes were tried and what the site answered, so a failure can be diagnosed.
 */

/** the route that means «this machine calls the site itself» (its origin is the page's) */
export const DIRECT = 'direct'

/** Upstream's refusal of a missing / spent / wrong captcha token: HTTP 403 {"message":"Каптча тасдиқланмади"}. */
export const isCaptchaRefusal = (status: number, body: string): boolean => status === 403 && /капт?ча|captcha/i.test(body)

export interface OrderFileDeps {
  /** mint a download token, the whole session on `route` (DIRECT or a worker URL) */
  getToken: (route: string) => Promise<string>
  /** GET the file with that token from `route` (no hedge: the token is single-use) */
  download: (pdfId: string, token: string, route: string) => Promise<{ status: number; body: Uint8Array }>
  /** the best worker not in `exclude` (undefined when there is none) */
  pick: (exclude: string[]) => string | undefined
}

const label = (route: string): string => {
  if (route === DIRECT) return 'bu kompyuter'
  try {
    return new URL(route).hostname
  } catch {
    return 'worker'
  }
}
const clip = (s: string, n = 120): string => s.replace(/\s+/g, ' ').trim().slice(0, n)

export async function fetchOrderFileWith(pdfId: string, deps: OrderFileDeps, maxRoutes = 3): Promise<Uint8Array> {
  const routes: string[] = [DIRECT]
  const notes: string[] = []
  for (let i = 0; i < maxRoutes; i++) {
    const route = i === 0 ? DIRECT : deps.pick(routes.filter((r) => r !== DIRECT))
    if (!route) break
    if (i > 0) routes.push(route)
    let token: string
    try {
      token = await deps.getToken(route)
    } catch (e) {
      notes.push(`${label(route)}: token olinmadi (${clip(e instanceof Error ? e.message : String(e))})`)
      continue
    }
    let res: { status: number; body: Uint8Array }
    try {
      res = await deps.download(pdfId, token, route)
    } catch (e) {
      notes.push(`${label(route)}: yuklab boʻlmadi (${clip(e instanceof Error ? e.message : String(e))})`)
      continue
    }
    if (res.status >= 200 && res.status < 300) return res.body
    const text = Buffer.from(res.body.subarray(0, 300)).toString('utf8')
    if (isCaptchaRefusal(res.status, text)) {
      notes.push(`${label(route)}: token qabul qilinmadi`)
      continue
    }
    throw new Error(`public.sud.uz file: HTTP ${res.status} (${label(route)}) ${clip(text, 80)}`.trim())
  }
  throw new Error(`public.sud.uz file: captcha oʻtmadi · ${notes.join(' · ') || 'yoʻl topilmadi'}`)
}
