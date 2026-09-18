/**
 * v206 scheduler smoke — runs the REAL worker-fetch module against jadvalapi
 * from the same runtime the app uses, printing exact statuses/errors.
 */
import { fetchViaWorkers } from '../src/lib/net/worker-fetch.ts'

const TARGET = 'https://jadvalapi.sud.uz/online-monitoring/ECONOMIC/findByTin/302678824'

async function main() {
  const t0 = Date.now()
  try {
    const res = await fetchViaWorkers(TARGET, {
      originKey: 'jadvalapi.sud.uz',
      timeoutMs: 12_000,
      hedgeMs: 800,
      maxAttempts: 3,
    })
    const text = await res.text()
    console.log(`OK status=${res.status} ms=${Date.now() - t0} bytes=${text.length} preview=${text.slice(0, 80)}`)
  } catch (e) {
    const err = e as Error & { errors?: unknown[] }
    console.error(`FAILED ms=${Date.now() - t0} name=${err?.name} message=${err?.message}`)
    console.error('isAggregate:', err instanceof AggregateError, 'errors:', err?.errors?.length ?? 'n/a')
    console.error('stack:', err?.stack)
  }
}
void main()
