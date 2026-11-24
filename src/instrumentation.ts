/**
 * Runs once when the server starts. It only starts three timers, Kuzatuv's (lib/watch), the automatic backup's (lib/auto-backup) and the bot link's (lib/bot-link); each does nothing until the operator
 * switches its setting on (Settings › Telegram). Node runtime only: the edge runtime has no database and no timers worth having.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { retireStaleSnapshotsOnce } = await import('./lib/snapshot-migrate')
  retireStaleSnapshotsOnce()
  const { startWatchScheduler } = await import('./lib/watch')
  startWatchScheduler()
  const { startAutoBackup } = await import('./lib/auto-backup')
  startAutoBackup()
  const { startBotLink } = await import('./lib/bot-link')
  startBotLink()
}
