/**
 * Cloudflare Worker — CORS proxy for sud.uz + mib.uz
 *
 * Deploy this as a free Cloudflare Worker to get your own private CORS proxy
 * with NO rate limits (unlike proxy.cors.sh which limits to ~30 req/min).
 * Cloudflare Workers run on 300+ edge locations worldwide, so they're fast
 * and rarely IP-blocked by sud.uz / mib.uz.
 *
 * ## Deploy in 2 minutes:
 * 1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 * 2. Name it "sud-proxy" (or anything)
 * 3. Copy this entire file into the editor
 * 4. Click "Deploy"
 * 5. Copy your worker URL (e.g. https://sud-proxy.your-name.workers.dev)
 * 6. Add to your project's .env file:
 *      CF_WORKER_URLS=https://sud-proxy.your-name.workers.dev
 * 7. Restart `bun run dev`
 *
 * ## How it works:
 * The worker receives a request like:
 *   https://sud-proxy.your-name.workers.dev/https://billing.sud.uz/api/invoice/checkStatus?invoice=123&lang=ru
 * It fetches the target URL from Cloudflare's edge network (with full browser
 * headers so anti-bot protections like mib.uz accept it) and returns the
 * response with CORS headers so the browser can read it.
 *
 * ## Security:
 * This worker ONLY proxies requests to the allowed hosts below.
 * All other targets are rejected (prevents abuse as an open proxy).
 *
 * ## Free tier limits:
 * Cloudflare Workers free plan: 100,000 requests/day — more than enough.
 */

const sudProxyWorker = {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      })
    }

    // Extract target URL from the path: /https://billing.sud.uz/...
    const url = new URL(request.url)
    const targetUrl = url.pathname.substring(1) + (url.search || '')

    if (!targetUrl.startsWith('http')) {
      return new Response(
        JSON.stringify({
          error: 'Missing target URL',
          usage: 'Append the full URL to the worker path, e.g. https://your-worker.workers.dev/https://billing.sud.uz/api/...',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      )
    }

    // Security: only allow proxying to approved hosts (prevents open-proxy abuse)
    const target = new URL(targetUrl)
    const ALLOWED_HOSTS = [
      'billing.sud.uz',
      'recaptcha.sud.uz',
      'my.sud.uz',
      'jadval.sud.uz',
      'jadvalapi.sud.uz',
      'jadval2.sud.uz',
      'orginfo.uz',
      'mib.uz',
      'www.mib.uz',
      'chamber.uz',
      'admin.chamber.uz',
      'ihamkor.uz',
    ]
    if (!ALLOWED_HOSTS.includes(target.hostname)) {
      return new Response(
        JSON.stringify({ error: `Host ${target.hostname} not allowed. Permitted: ${ALLOWED_HOSTS.join(', ')}` }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      )
    }

    // Forward the request to the target with FULL BROWSER HEADERS.
    // mib.uz blocks requests that look like bots (missing Accept, Accept-Language,
    // sec-* headers). Sending a complete Chrome fingerprint gets past the block.
    try {
      const headers = new Headers()
      // Start from the incoming headers but only keep safe ones
      const safeIncoming = ['content-type', 'wicket-ajax', 'wicket-ajax-baseurl', 'x-requested-with']
      for (const [k, v] of request.headers.entries()) {
        if (safeIncoming.includes(k.toLowerCase())) {
          headers.set(k, v)
        }
      }
      // Full Chrome 151 on Windows fingerprint — matches what my.sud.uz browser sends.
      // v148: Changed Origin from target.origin to 'https://my.sud.uz' — jadval.sud.uz
      // checks Origin header and only returns data when Origin is my.sud.uz.
      // v148: Changed Sec-Fetch-Site from 'none' to 'same-site' — matches browser.
      // v148: Changed Accept to JSON (was HTML) — matches my.sud.uz API calls.
      headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36')
      headers.set('Accept', 'application/json, text/plain, */*')
      headers.set('Accept-Language', 'en-GB,en;q=0.5')
      headers.set('Accept-Encoding', 'gzip, deflate, br')
      headers.set('Cache-Control', 'no-cache')
      headers.set('Pragma', 'no-cache')
      headers.set('Sec-Ch-Ua', '"Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"')
      headers.set('Sec-Ch-Ua-Mobile', '?0')
      headers.set('Sec-Ch-Ua-Platform', '"Windows"')
      headers.set('Sec-Fetch-Dest', 'empty')
      headers.set('Sec-Fetch-Mode', 'cors')
      headers.set('Sec-Fetch-Site', 'same-site')
      headers.set('Sec-GPC', '1')
      headers.set('Origin', 'https://my.sud.uz')
      headers.set('Referer', 'https://my.sud.uz/')

      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'follow',
      })

      // Return the response with CORS headers
      const newHeaders = new Headers(response.headers)
      newHeaders.set('Access-Control-Allow-Origin', '*')
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      newHeaders.set('Access-Control-Allow-Headers', '*')
      newHeaders.set('Access-Control-Expose-Headers', '*')

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      })
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Upstream fetch failed', detail: e.message }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      )
    }
  },
}

export default sudProxyWorker
