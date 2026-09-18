/**
 * v205 (§5.7): Next.js instrumentation hook — runs once per server process.
 * Starts the docket-index crawler when CRAWLER_ENABLED=true on the persistent
 * host (see src/lib/crawler/scheduler.ts). No-op otherwise.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCrawler } = await import('@/lib/crawler/scheduler')
    startCrawler()
  }
}
