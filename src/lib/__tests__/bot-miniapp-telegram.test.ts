/**
 * The Mini App's end of Telegram's client protocol (bot/static/js/core/telegram-core.js), run with a fake window: what it tells the client at start (ready,
 * expand, fullscreen where wanted and possible), how it follows the client's answers (fullscreen state, safe areas), and that nothing breaks outside Telegram.
 */
import { describe, expect, test } from 'bun:test'

// a plain JS module of the bot's static files: loaded by path, so the TypeScript build does not need a declaration for it
const path = '../../../bot/static/js/core/telegram-core.js'
const core = (await import(path)) as {
  versionOf: (hash: string) => number
  createTelegram: (d: unknown) => {
    version: number
    platform: string
    can: { fullscreen: boolean; safeArea: boolean; swipe: boolean }
    isFullscreen: () => boolean
    onFullscreen: (fn: (on: boolean) => void) => () => void
    toggleFullscreen: () => void
    start: () => void
    receive: (type: string, data: unknown) => void
  }
}

type Sent = { type: string; data: unknown }

function setup(opts: { hash: string; stored?: string | null; proxy?: boolean; framed?: boolean; storageThrows?: boolean }) {
  const sent: Sent[] = []
  const vars = new Map<string, string>()
  const dataset: Record<string, string> = {}
  const listeners: Array<(e: { source: unknown; data: string }) => void> = []
  const parent = { postMessage: (m: string) => { const j = JSON.parse(m) as { eventType: string; eventData: unknown }; sent.push({ type: j.eventType, data: j.eventData }) } }
  const store = new Map<string, string>()
  if (opts.stored != null) store.set('sud.fullscreen', opts.stored)
  const win: Record<string, unknown> = {
    parent: opts.framed === false ? undefined : parent,
    addEventListener: (_: string, fn: (e: { source: unknown; data: string }) => void) => listeners.push(fn),
  }
  if (opts.framed === false) win.parent = win
  if (opts.proxy) win.TelegramWebviewProxy = { postEvent: (type: string, data: string) => sent.push({ type, data: data ? JSON.parse(data) : '' }) }
  const doc = { documentElement: { style: { setProperty: (k: string, v: string) => vars.set(k, v) }, dataset } }
  const storage = opts.storageThrows
    ? { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  const tg = core.createTelegram({ win, hash: opts.hash, storage, doc })
  return { tg, sent, vars, dataset, store, win, parent, message: (source: unknown, data: unknown) => listeners.forEach((fn) => fn({ source, data: typeof data === 'string' ? data : JSON.stringify(data) })) }
}

const types = (s: Sent[]) => s.map((x) => x.type)
const H = (v: string, platform: string) => `#tgWebAppData=x&tgWebAppVersion=${v}&tgWebAppPlatform=${platform}`

describe('what the page tells the client at start', () => {
  test('on a phone with a current client: ready, expand, header colour, safe areas, FULLSCREEN', () => {
    const t = setup({ hash: H('8.0', 'ios') })
    t.tg.start()
    expect(types(t.sent)).toEqual(['web_app_ready', 'web_app_expand', 'web_app_set_header_color', 'web_app_request_safe_area', 'web_app_request_content_safe_area', 'web_app_request_fullscreen'])
    expect(t.sent[2]!.data).toEqual({ color_key: 'bg_color' })
    expect(t.tg.can).toEqual({ fullscreen: true, safeArea: true, swipe: true })
  })

  test('on a desktop client fullscreen is not forced (it is the person\'s button), unless they chose it before', () => {
    const d = setup({ hash: H('8.0', 'tdesktop') })
    d.tg.start()
    expect(types(d.sent)).not.toContain('web_app_request_fullscreen')
    const chose = setup({ hash: H('8.0', 'tdesktop'), stored: '1' })
    chose.tg.start()
    expect(types(chose.sent)).toContain('web_app_request_fullscreen')
  })

  test('a phone person who left fullscreen is not put back into it on the next launch', () => {
    const t = setup({ hash: H('8.0', 'android'), stored: '0' })
    t.tg.start()
    expect(types(t.sent)).not.toContain('web_app_request_fullscreen')
  })

  test('an older client gets only what it understands; outside Telegram nothing is sent at all', () => {
    const old = setup({ hash: H('7.0', 'ios') })
    old.tg.start()
    expect(types(old.sent)).toEqual(['web_app_ready', 'web_app_expand', 'web_app_set_header_color'])
    expect(old.tg.can).toEqual({ fullscreen: false, safeArea: false, swipe: false })
    const outside = setup({ hash: '' })
    outside.tg.start()
    expect(outside.sent).toEqual([])
    expect(core.versionOf('')).toBe(0)
    expect(core.versionOf('#tgWebAppVersion=7.10')).toBe(7.1) // as the client numbers it (Telegram's own library compares the same way)
  })

  test('start is once only', () => {
    const t = setup({ hash: H('8.0', 'ios') })
    t.tg.start()
    t.tg.start()
    expect(types(t.sent).filter((x) => x === 'web_app_ready')).toHaveLength(1)
  })

  test('the mobile client\'s own channel is used when it is there, else the frame\'s parent; no channel is no crash', () => {
    const viaProxy = setup({ hash: H('8.0', 'android'), proxy: true })
    viaProxy.tg.start()
    expect(types(viaProxy.sent)[0]).toBe('web_app_ready')
    const alone = setup({ hash: H('8.0', 'android'), framed: false })
    expect(() => alone.tg.start()).not.toThrow()
    expect(alone.sent).toEqual([])
  })
})

describe('what the client answers', () => {
  test('fullscreen_changed sets the state, tells the watchers, and stops a swipe from closing the page while fullscreen', () => {
    const t = setup({ hash: H('8.0', 'ios') })
    const seen: boolean[] = []
    t.tg.onFullscreen((on) => seen.push(on))
    t.tg.receive('fullscreen_changed', { is_fullscreen: true })
    expect(t.tg.isFullscreen()).toBe(true)
    expect(t.dataset.fullscreen).toBe('1')
    expect(t.sent.at(-1)).toEqual({ type: 'web_app_setup_swipe_behavior', data: { allow_vertical_swipe: false } })
    t.tg.receive('fullscreen_changed', JSON.stringify({ is_fullscreen: false })) // the data may arrive as text
    expect(t.tg.isFullscreen()).toBe(false)
    expect(t.sent.at(-1)).toEqual({ type: 'web_app_setup_swipe_behavior', data: { allow_vertical_swipe: true } })
    expect(seen).toEqual([true, false])
  })

  test('ALREADY_FULLSCREEN is a state, other failures change nothing', () => {
    const t = setup({ hash: H('8.0', 'ios') })
    t.tg.receive('fullscreen_failed', { error: 'UNSUPPORTED' })
    expect(t.tg.isFullscreen()).toBe(false)
    t.tg.receive('fullscreen_failed', { error: 'ALREADY_FULLSCREEN' })
    expect(t.tg.isFullscreen()).toBe(true)
  })

  test('the safe areas become CSS variables, whole non-negative pixels, for both the system and Telegram\'s own buttons', () => {
    const t = setup({ hash: H('8.0', 'ios') })
    t.tg.receive('safe_area_changed', { top: 47.4, bottom: 34, left: 0, right: -3 })
    t.tg.receive('content_safe_area_changed', { top: 56, bottom: 0, left: 0, right: 0 })
    expect(t.vars.get('--tg-safe-top')).toBe('47px')
    expect(t.vars.get('--tg-safe-bottom')).toBe('34px')
    expect(t.vars.get('--tg-safe-right')).toBe('0px')
    expect(t.vars.get('--tg-content-safe-top')).toBe('56px')
    t.tg.receive('safe_area_changed', {}) // a missing side is zero, never NaN
    expect(t.vars.get('--tg-safe-top')).toBe('0px')
  })

  test('messages are read only from the frame that holds the page, and a stranger\'s text is ignored', () => {
    const t = setup({ hash: H('8.0', 'web') })
    t.message({}, { eventType: 'fullscreen_changed', eventData: { is_fullscreen: true } })
    expect(t.tg.isFullscreen()).toBe(false) // another window
    t.message(t.parent, 'not json')
    t.message(t.parent, { eventType: 5 })
    expect(t.tg.isFullscreen()).toBe(false)
    t.message(t.parent, { eventType: 'fullscreen_changed', eventData: { is_fullscreen: true } })
    expect(t.tg.isFullscreen()).toBe(true)
    // the mobile apps call receiveEvent on the page's global object
    const win = t.win as { Telegram: { WebView: { receiveEvent: (a: string, b: unknown) => void } } }
    win.Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: false })
    expect(t.tg.isFullscreen()).toBe(false)
  })
})

describe('the person\'s button', () => {
  test('toggling asks the client for the other state and remembers the choice for the next launch', () => {
    const t = setup({ hash: H('8.0', 'tdesktop') })
    t.tg.toggleFullscreen()
    expect(t.sent.at(-1)!.type).toBe('web_app_request_fullscreen')
    expect(t.store.get('sud.fullscreen')).toBe('1')
    t.tg.receive('fullscreen_changed', { is_fullscreen: true })
    t.tg.toggleFullscreen()
    expect(t.sent.at(-1)!.type).toBe('web_app_exit_fullscreen')
    expect(t.store.get('sud.fullscreen')).toBe('0')
  })
  test('on a client that cannot do fullscreen the button does nothing', () => {
    const t = setup({ hash: H('7.0', 'ios') })
    t.tg.toggleFullscreen()
    expect(t.sent).toEqual([])
  })
  test('blocked storage (a private window) does not break anything', () => {
    const t = setup({ hash: H('8.0', 'ios'), storageThrows: true })
    expect(() => t.tg.start()).not.toThrow()
    expect(types(t.sent)).toContain('web_app_request_fullscreen') // the phone default
    expect(() => t.tg.toggleFullscreen()).not.toThrow()
  })
})
