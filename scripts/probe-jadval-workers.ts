/**
 * v207 jadval worker-path probe — tries the flaky jadval.sud.uz archive
 * endpoint through the CF-worker scheduler (Cloudflare egress IPs = a
 * DIFFERENT throttle bucket than the sandbox's own IP). Reports per-try
 * byte counts so we can see if any worker lands the full archive.
 */
import { fetchViaWorkers } from '../src/lib/net/worker-fetch.ts'

const TARGET = 'https://jadval.sud.uz/case/findByTin/200248856'

async function tryOnce(n: number): Promise<boolean> {
  const t0 = Date.now()
  try {
    const res = await fetchViaWorkers(TARGET, {
      originKey: 'jadval.sud.uz',
      timeoutMs: 30_000,
      hedgeMs: 800,
      maxAttempts: 3,
    })
    const text = await res.text()
    const ok = text.startsWith('[')
    console.log(`try${n}: status=${res.status} ms=${Date.now() - t0} bytes=${text.length} json=${ok} preview=${text.slice(0, 60).replace(/\n/g, ' ')}`)
    return ok
  } catch (e) {
    console.log(`try${n}: FAILED ms=${Date.now() - t0} ${(e as Error).message?.slice(0, 120)}`)
    return false
  }
}

async function main() {
  for (let i = 1; i <= 4; i++) {
    if (await tryOnce(i)) {
      console.log(`=> worker path LANDED on try${i}`)
      return
    }
    if (i < 4) await new Promise(r => setTimeout(r, 6_000))
  }
  console.log('=> worker path never landed (throttle covers CF egress ranges too right now)')
}
void main()
