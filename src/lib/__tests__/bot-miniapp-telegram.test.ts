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
    guess: () => void
    diagnostics: () => { version: number; platform: string; fullscreen: boolean; requested: boolean; gotSafe: boolean; gotContent: boolean; events: Array<{ type: string; data: string }> }
  }
}

type Sent = { type: string; data: unknown }

function setup(opts: { hash: string; stored?: string | null; proxy?: boolean; framed?: boolean; storageThrows?: boolean; inner?: number; screenH?: number }) {
  const sent: Sent[] = []
  const vars = new Map<string, string>()
  const dataset: Record<string, string> = {}
  const listeners: Array<(e: { source: unknown; data: string }) => void> = []
  const parent = { postMessage: (m: string) => { const j = JSON.parse(m) as { eventType: string; eventData: unknown }; sent.push({ type: j.eventType, data: j.eventData }) } }
  const store = new Map<string, string>()
  if (opts.stored != null) store.set('sud.fullscreen', opts.stored)
  const timers: Array<() => void> = []
  const win: Record<string, unknown> = {
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length },
    innerHeight: opts.inner ?? 800,
    screen: { height: opts.screenH ?? 800 },
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
  return { tg, sent, vars, dataset, store, win, parent, timers, message: (source: unknown, data: unknown) => listeners.forEach((fn) => fn({ source, data: typeof data === 'string' ? data : JSON.stringify(data) })) }
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

  test('on a desktop client there is no fullscreen at all: no request, no toggle, even if they chose it before', () => {
    const d = setup({ hash: H('8.0', 'tdesktop') })
    d.tg.start()
    expect(types(d.sent)).not.toContain('web_app_request_fullscreen')
    expect(d.tg.can.fullscreen).toBe(false)
    const chose = setup({ hash: H('8.0', 'tdesktop'), stored: '1' })
    chose.tg.start()
    expect(types(chose.sent)).not.toContain('web_app_request_fullscreen')
    // a laptop client that came up fullscreen anyway is put back in its window
    chose.tg.receive('fullscreen_changed', { is_fullscreen: true })
    expect(types(chose.sent)).toContain('web_app_exit_fullscreen')
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
    const t = setup({ hash: H('8.0', 'ios') })
    t.tg.toggleFullscreen()
    expect(t.sent.at(-1)!.type).toBe('web_app_request_fullscreen')
    expect(t.store.get('sud.fullscreen')).toBe('1')
    t.tg.receive('fullscreen_changed', { is_fullscreen: true })
    t.tg.toggleFullscreen()
    expect(t.sent.at(-1)!.type).toBe('web_app_exit_fullscreen')
    expect(t.store.get('sud.fullscreen')).toBe('0')
  })
  test('on a laptop client the button does nothing (fullscreen is for phones)', () => {
    const t = setup({ hash: H('8.0', 'tdesktop') })
    t.tg.toggleFullscreen()
    expect(t.sent).toEqual([])
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

describe('every place the clients hand their answers over', () => {
  test('Android\'s Telegram.WebView, iOS\'s TelegramGameProxy and the flat function all reach the page', () => {
    const t = setup({ hash: H('8.0', 'ios') })
    const win = t.win as {
      Telegram: { WebView: { receiveEvent: (a: string, b: unknown) => void } }
      TelegramGameProxy: { receiveEvent: (a: string, b: unknown) => void }
      TelegramGameProxy_receiveEvent: (a: string, b: unknown) => void
    }
    win.TelegramGameProxy.receiveEvent('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 })
    expect(t.vars.get('--tg-safe-top')).toBe('59px')
    win.TelegramGameProxy_receiveEvent('content_safe_area_changed', JSON.stringify({ top: 44, bottom: 0, left: 0, right: 0 }))
    expect(t.vars.get('--tg-content-safe-top')).toBe('44px')
    win.Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: true })
    expect(t.tg.isFullscreen()).toBe(true)
    // and the diagnostics page can say what came
    const d = t.tg.diagnostics()
    expect(d.gotSafe && d.gotContent && d.fullscreen).toBe(true)
    expect(d.events.map((e) => e.type)).toEqual(['safe_area_changed', 'content_safe_area_changed', 'fullscreen_changed'])
  })
})

describe('when the client does not answer: a guess keeps the page out of the status bar and Telegram\'s buttons', () => {
  test('a phone asked for fullscreen, whose page is as tall as the screen, gets typical insets after the wait', () => {
    const t = setup({ hash: H('8.0', 'ios'), inner: 844, screenH: 844 })
    t.tg.start()
    expect(t.timers).toHaveLength(1)
    t.timers[0]!()
    expect(t.dataset.safe).toBe('guess')
    expect(t.vars.get('--tg-safe-top')).toBe('52px')
    expect(t.vars.get('--tg-safe-bottom')).toBe('34px')
    expect(t.vars.get('--tg-content-safe-top')).toBe('56px')
    // the client's real numbers replace the guess, and the mark goes
    t.tg.receive('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 })
    expect(t.vars.get('--tg-safe-top')).toBe('59px')
    expect(t.dataset.safe).toBeUndefined()
  })

  test('Android has its own typical status bar, and no bottom inset', () => {
    const t = setup({ hash: H('8.0', 'android'), inner: 800, screenH: 800 })
    t.tg.start()
    t.timers[0]!()
    expect(t.vars.get('--tg-safe-top')).toBe('28px')
    expect(t.vars.get('--tg-safe-bottom')).toBe('0px')
  })

  test('no guess when the client DID answer, when the page is not fullscreen-sized, on a desktop client, or when fullscreen was not asked for', () => {
    const answered = setup({ hash: H('8.0', 'ios'), inner: 844, screenH: 844 })
    answered.tg.start()
    answered.tg.receive('safe_area_changed', { top: 47, bottom: 34, left: 0, right: 0 })
    answered.timers[0]!()
    expect(answered.vars.get('--tg-safe-top')).toBe('47px')
    expect(answered.dataset.safe).toBeUndefined()

    const sheet = setup({ hash: H('8.0', 'ios'), inner: 650, screenH: 844 }) // the sheet that leaves a strip of the chat visible
    sheet.tg.start()
    sheet.timers[0]!()
    expect(sheet.vars.has('--tg-safe-top')).toBe(false)

    const desktop = setup({ hash: H('8.0', 'tdesktop'), inner: 800, screenH: 800 })
    desktop.tg.start()
    desktop.timers[0]!()
    expect(desktop.vars.has('--tg-safe-top')).toBe(false)

    const declined = setup({ hash: H('8.0', 'ios'), stored: '0', inner: 844, screenH: 844 })
    declined.tg.start()
    declined.timers[0]!()
    expect(declined.vars.has('--tg-safe-top')).toBe(false)
  })

  test('a fullscreen the client confirmed counts even when the page does not look as tall as the screen', () => {
    const t = setup({ hash: H('8.0', 'ios'), inner: 700, screenH: 844 })
    t.tg.start()
    t.tg.receive('fullscreen_changed', { is_fullscreen: true })
    t.timers[0]!()
    expect(t.dataset.safe).toBe('guess')
  })
})

