/**
 * The site's firewall (WAF) answers a request it dislikes with a block page and HTTP 500:
 *
 *   {"page_title":"Web Page Blocked!","display_message":"The page cannot be displayed…","client_IP":"…","URL":"…","attack_ID":"20000050"}
 *
 * That is NOT a server error and NOT a missing case: every search from this machine is refused, and each further request
 * can only lengthen the block. So the first block pauses all direct requests for a while (a circuit breaker), and the error
 * says what it is instead of «HTTP 500». Pure (clock injected): tested in __tests__/waf.test.ts.
 */

export interface WafBlock {
  attackId: string
  clientIp: string
}

/** Is this response body the firewall's block page? */
export function parseWafBlock(text: string): WafBlock | null {
  if (!/Web Page Blocked!|"attack_ID"/i.test(text)) return null
  const pick = (k: string) => new RegExp(`"${k}"\\s*:\\s*"([^"]{0,64})"`, 'i').exec(text)?.[1] ?? ''
  return { attackId: pick('attack_ID'), clientIp: pick('client_IP') }
}

export const WAF_COOLDOWN_MS = 15 * 60_000

const G = globalThis as typeof globalThis & { __sudWaf?: { until: number; block: WafBlock | null } }
const state = () => (G.__sudWaf ??= { until: 0, block: null })

export function wafMessage(b: WafBlock | null, minutesLeft?: number): string {
  const who = b ? ` (attack_ID ${b.attackId || '?'}${b.clientIp ? `, sizning IP ${b.clientIp}` : ''})` : ''
  const wait = minutesLeft ? ` Yana ${minutesLeft} daqiqa soʻrov yuborilmaydi.` : ''
  return `public.sud.uz himoya tizimi (WAF) soʻrovni blokladi${who}. Bu server xatosi emas: IP manzil vaqtincha toʻsilgan boʻlishi mumkin.${wait} Brauzerda public.sud.uz ochilishini tekshiring, birozdan soʻng qayta urining.`
}

export function noteWafBlock(b: WafBlock, now = Date.now()): void {
  const s = state()
  s.until = now + WAF_COOLDOWN_MS
  s.block = b
}

/** Throws the explanatory error while the cool-down lasts. Call before every DIRECT request to the site. */
export function assertNotWafBlocked(now = Date.now()): void {
  const s = state()
  if (now < s.until) throw new Error(wafMessage(s.block, Math.max(1, Math.ceil((s.until - now) / 60_000))))
}

export function clearWafBlock(): void {
  const s = state()
  s.until = 0
  s.block = null
}

/**
 * An upstream answered with a non-2xx status: read what it said and throw the right error. The firewall's page starts the
 * cool-down (only for DIRECT requests: a worker has another IP), anything else keeps the site's own words, because a bare
 * «HTTP 500» cannot be told apart from our own mistake. `label` heads the error, `ctx` heads the dev.log line.
 */
export async function throwUpstreamFailure(res: Response, label: string, ctx: string, direct: boolean): Promise<never> {
  const raw = await res.text().catch(() => '')
  const waf = parseWafBlock(raw)
  if (waf) {
    if (direct) noteWafBlock(waf)
    console.error(`[orders-search] ${ctx}: BLOCKED by the site's firewall (attack_ID ${waf.attackId}, IP ${waf.clientIp})`)
    throw new Error(wafMessage(waf))
  }
  const said = raw.replace(/\s+/g, ' ').slice(0, 240)
  console.error(`[orders-search] ${ctx}: HTTP ${res.status} ${said}`)
  throw new Error(`${label}: HTTP ${res.status}${said ? ` \u2014 ${said.slice(0, 100)}` : ''}`)
}
