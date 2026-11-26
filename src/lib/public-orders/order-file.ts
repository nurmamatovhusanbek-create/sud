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

/**
 * Every route was tried and none got a token the download accepted (or none could mint one). The site now wants a
 * human-verified token for downloads; callers treat this as «ask the person to download it by hand», not as a glitch.
 */
export class CaptchaRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptchaRefusedError'
  }
}

/** Upstream's refusal of a missing / spent / wrong captcha token: HTTP 403 {"message":"Каптча тасдиқланмади"}. */
export const isCaptchaRefusal = (status: number, body: string): boolean => status === 403 && /капт?ча|captcha/i.test(body)

export interface OrderFileDeps {
  /** mint a download token, the whole session on `route` (DIRECT or a worker URL) */
  getToken: (route: string) => Promise<string>
  /** GET the file with that token from `route` (no hedge: the token is single-use) */
  download: (pdfId: string, token: string, route: string) => Promise<{ status: number; body: Uint8Array }>
  /** the best worker not in `exclude` (undefined when there is none) */
  pick: (exclude: string[]) => string | undefined
  /** routes that just failed for a reason that will repeat are rested (see `createRouteHealth`); absent = every route is always tried */
  health?: RouteHealth
  /** round robin: the start of each download moves to the next route, so the load (and the IP the site sees) is spread; absent = this machine first, always */
  rotate?: () => number
}

/**
 * Which routes are worth trying right now. A route that cannot mint a token (the captcha host times out, 3 × 10 s) or whose worker answers «Host … not
 * allowed» (a worker deployed before this host was added) fails EVERY order the same way: trying it again for each of 200 orders costs 30 s each. The first failure rests the
 * route (`restMs`); a success clears it. Pure (clock injected).
 */
export interface RouteHealth {
  /** why the route is resting, or null when it may be tried */
  resting: (route: string) => string | null
  rest: (route: string, why: string, ms: number) => void
  ok: (route: string) => void
}

export function createRouteHealth(now: () => number = Date.now): RouteHealth {
  const m = new Map<string, { until: number; why: string }>()
  return {
    resting: (route) => {
      const r = m.get(route)
      if (!r) return null
      if (now() >= r.until) {
        m.delete(route)
        return null
      }
      return r.why
    },
    rest: (route, why, ms) => void m.set(route, { until: now() + ms, why }),
    ok: (route) => void m.delete(route),
  }
}

export const REST_TOKEN_MS = 10 * 60_000
export const REST_NETWORK_MS = 5 * 60_000
export const REST_HOST_MS = 60 * 60_000

/** a worker (or this machine's proxy) refusing the HOST itself: deployed before the host was added; the same for every order until it is redeployed */
export const isHostNotAllowed = (status: number, body: string): boolean => status === 403 && /Host .+ not allowed/i.test(body)

const label = (route: string): string => {
  if (route === DIRECT) return 'bu kompyuter'
  try {
    return new URL(route).hostname
  } catch {
    return 'worker'
  }
}
const clip = (s: string, n = 120): string => s.replace(/\s+/g, ' ').trim().slice(0, n)

/** The candidate routes: this machine and up to two workers, in the order they are tried (rotated when `rotate` is given). */
function candidates(deps: OrderFileDeps, maxRoutes: number): string[] {
  const all: string[] = [DIRECT]
  while (all.length < maxRoutes) {
    const w = deps.pick(all.filter((r) => r !== DIRECT))
    if (!w || all.includes(w)) break
    all.push(w)
  }
  if (!deps.rotate || all.length < 2) return all
  const k = ((deps.rotate() % all.length) + all.length) % all.length
  return [...all.slice(k), ...all.slice(0, k)]
}

export async function fetchOrderFileWith(pdfId: string, deps: OrderFileDeps, maxRoutes = 3): Promise<Uint8Array> {
  const notes: string[] = []
  let refused = 0
  const routes = candidates(deps, maxRoutes)
  for (const route of routes) {
    const why = deps.health?.resting(route)
    if (why) {
      notes.push(`${label(route)}: dam olmoqda (${why})`)
      continue
    }
    let token: string
    try {
      token = await deps.getToken(route)
    } catch (e) {
      const msg = clip(e instanceof Error ? e.message : String(e))
      deps.health?.rest(route, `token olinmadi: ${msg}`, REST_TOKEN_MS)
      notes.push(`${label(route)}: token olinmadi (${msg})`)
      continue
    }
    let res: { status: number; body: Uint8Array }
    try {
      res = await deps.download(pdfId, token, route)
    } catch (e) {
      const msg = clip(e instanceof Error ? e.message : String(e))
      deps.health?.rest(route, `yuklab boʻlmadi: ${msg}`, REST_NETWORK_MS)
      notes.push(`${label(route)}: yuklab boʻlmadi (${msg})`)
      continue
    }
    if (res.status >= 200 && res.status < 300) {
      deps.health?.ok(route)
      return res.body
    }
    const text = Buffer.from(res.body.subarray(0, 300)).toString('utf8')
    if (isCaptchaRefusal(res.status, text)) {
      refused++
      notes.push(`${label(route)}: token qabul qilinmadi`)
      continue
    }
    if (isHostNotAllowed(res.status, text)) {
      // the same for every order until the worker is redeployed: rest it for an hour and let the next route serve this order
      const msg = `bu worker sud.uz qaror serverini oʻtkazmaydi (eski nusxa): cloudflare-worker/proxy.js ni Cloudflareʼda qayta deploy qiling`
      deps.health?.rest(route, msg, REST_HOST_MS)
      notes.push(`${label(route)}: ${msg}`)
      continue
    }
    throw new Error(`public.sud.uz file: HTTP ${res.status} (${label(route)}) ${clip(text, 80)}`.trim())
  }
  // a refusal of the TOKEN is the site wanting a person (the caller then rests the whole door); anything else is a route that does not work, said as it is
  if (refused > 0) throw new CaptchaRefusedError(`public.sud.uz file: captcha oʻtmadi · ${notes.join(' · ')}`)
  throw new RoutesFailedError(`public.sud.uz file: hech bir yoʻl ishlamadi · ${notes.join(' · ') || 'yoʻl topilmadi'}`)
}

/** No route could fetch the file and none of them was a token refusal: the setup (a worker, the captcha host, the network) is what is wrong. */
export class RoutesFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutesFailedError'
  }
}
