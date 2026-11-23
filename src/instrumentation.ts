/**
 * Runs once when the server starts. It only starts Kuzatuv's timer (lib/watch), which does nothing until the operator switches the setting on
 * (Settings › Telegram › Kuzatuv). Node runtime only: the edge runtime has no database and no timers worth having.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startWatchScheduler } = await import('./lib/watch')
  startWatchScheduler()
}
