/**
 * Waiting for an in-app update to really finish.
 *
 * An update restarts the server, and not once: `git pull` changes files, so Next's dev server may restart ITSELF (a changed
 * `next.config.ts`), and then the supervisor cycles it again after `bun install`. A browser request that is in flight during
 * either restart is cut off, so «the connection failed» does NOT mean «the update failed», and «something answered» does NOT
 * mean «the update is done» (it can be the first, soon-to-be-killed server). The signals that do mean it:
 *   - the commit moved (`sha` differs from before): the pull happened;
 *   - the server process is a new one (`bootedAt` differs): the new code is what answers;
 *   - and it keeps answering, from that same process, for a few polls in a row (the second restart would have cut it).
 * Pure over injected `read` / `sleep` / `now`, so every scenario is tested without a server.
 */

export interface VersionSnap {
  sha: string | null
  /** when the answering server process started (ms since epoch) */
  bootedAt: number
}

export type WaitOutcome = 'updated' | 'unchanged' | 'timeout'

export interface WaitDeps {
  /** one version read; null = the server did not answer */
  read: () => Promise<VersionSnap | null>
  sleep: (ms: number) => Promise<void>
  now: () => number
  onTick?: (elapsedMs: number) => void
}

export interface WaitOptions {
  budgetMs?: number
  intervalMs?: number
  /** consecutive answers from one process that count as «stable» */
  stableAnswers?: number
  /** how long to wait before concluding that nothing is going to restart */
  unchangedAfterMs?: number
}

export async function waitForUpdate(deps: WaitDeps, before: VersionSnap | null, opts: WaitOptions = {}): Promise<WaitOutcome> {
  // 10 minutes: `bun install` alone took 2 min on Windows once Next itself was upgraded (antivirus scans every file), then the server boots and compiles
  const { budgetMs = 600_000, intervalMs = 1500, stableAnswers = 4, unchangedAfterMs = 9_000 } = opts
  const start = deps.now()
  let streak = 0
  let lastBoot: number | null = null
  while (deps.now() - start < budgetMs) {
    await deps.sleep(intervalMs)
    const elapsed = deps.now() - start
    deps.onTick?.(elapsed)
    const v = await deps.read()
    if (!v) {
      streak = 0 // it went down: a restart is happening, which is expected
      lastBoot = null
      continue
    }
    streak = v.bootedAt === lastBoot ? streak + 1 : 1
    lastBoot = v.bootedAt
    const moved = before?.sha != null ? v.sha !== before.sha : before ? v.bootedAt !== before.bootedAt : true
    const restarted = before ? v.bootedAt !== before.bootedAt : true
    if (moved && restarted && streak >= stableAnswers) return 'updated'
    // answering steadily and nothing changed for a good while: no restart is coming (the pull found nothing, or the request really failed)
    if (!moved && streak >= stableAnswers && elapsed >= unchangedAfterMs) return 'unchanged'
  }
  return 'timeout'
}
