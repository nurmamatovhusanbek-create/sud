import { describe, expect, test } from 'bun:test'
import { waitForUpdate, type VersionSnap } from '../update-wait'

/** A scripted server: `script[i]` is what the i-th poll sees (null = connection refused). Time advances only through sleep(). */
function rig(script: (VersionSnap | null)[]) {
  let t = 0
  let i = 0
  const deps = {
    read: async () => script[Math.min(i++, script.length - 1)],
    sleep: async (ms: number) => void (t += ms),
    now: () => t,
  }
  return { deps, polls: () => i }
}
const OLD: VersionSnap = { sha: 'aaa', bootedAt: 1000 }
const NEW = (boot: number): VersionSnap => ({ sha: 'bbb', bootedAt: boot })

describe('waitForUpdate', () => {
  test('a clean restart: refused for a while, then the new process answers steadily → updated', async () => {
    const r = rig([null, null, null, NEW(2000), NEW(2000), NEW(2000), NEW(2000)])
    expect(await waitForUpdate(r.deps, OLD)).toBe('updated')
  })
  test('the DOUBLE restart (Next restarts itself, then the supervisor does): the first answerer is killed, so it does not count', async () => {
    // Next's own restart answers 2 polls, is killed, the supervisor's process comes up and stays
    const r = rig([null, NEW(2000), NEW(2000), null, null, NEW(3000), NEW(3000), NEW(3000), NEW(3000)])
    expect(await waitForUpdate(r.deps, OLD)).toBe('updated')
    expect(r.polls()).toBe(9) // it waited for the SECOND process to be steady, not the first
  })
  test('the old process still answering right after the pull (about to be killed) is not «done»', async () => {
    const r = rig([{ sha: 'bbb', bootedAt: 1000 }, { sha: 'bbb', bootedAt: 1000 }, null, NEW(2500), NEW(2500), NEW(2500), NEW(2500)])
    expect(await waitForUpdate(r.deps, OLD)).toBe('updated')
    expect(r.polls()).toBe(7)
  })
  test('the connection was cut but nothing changed and the server is simply up: «unchanged», after a fair wait', async () => {
    const r = rig([OLD])
    expect(await waitForUpdate(r.deps, OLD)).toBe('unchanged')
  })
  test('it never comes back → timeout', async () => {
    const r = rig([null])
    expect(await waitForUpdate(r.deps, OLD, { budgetMs: 30_000 })).toBe('timeout')
  })
  test('without a known «before» (git unavailable) a new, steady process is enough', async () => {
    const r = rig([null, NEW(5), NEW(5), NEW(5), NEW(5)])
    expect(await waitForUpdate(r.deps, null)).toBe('updated')
  })
  test('without a sha the process restart alone decides', async () => {
    const before: VersionSnap = { sha: null, bootedAt: 10 }
    const r = rig([null, { sha: null, bootedAt: 20 }, { sha: null, bootedAt: 20 }, { sha: null, bootedAt: 20 }, { sha: null, bootedAt: 20 }])
    expect(await waitForUpdate(r.deps, before)).toBe('updated')
  })
  test('a flapping server (up, down, up) never reaches «stable» until it really is', async () => {
    const r = rig([NEW(2), null, NEW(2), null, NEW(3), NEW(3), NEW(3), NEW(3)])
    expect(await waitForUpdate(r.deps, OLD)).toBe('updated')
    expect(r.polls()).toBe(8)
  })
})
