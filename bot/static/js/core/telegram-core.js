// The Mini App's own end of Telegram's client protocol, with every outside thing passed in (window, location hash, storage, document) so it runs without a browser
// in a test. There is NO external script: the page talks to the Telegram client with the same two messages Telegram's own library sends
// (`TelegramWebviewProxy.postEvent` in the mobile apps, `postMessage` to the parent frame in Telegram Web and Desktop) and listens for its answers.
//
// What it does: tells Telegram the page is ready (its loading placeholder goes away), expands the sheet, asks for FULLSCREEN where the client can (Bot API 8.0+,
// on by default on phones, a toggle everywhere), follows the safe areas (the status bar and Telegram's own buttons float over a fullscreen page, so the shell
// pads itself by them), keeps a vertical swipe from closing the page while it is fullscreen, and matches the header colour to the page.

/** `8.0` from `tgWebAppVersion`; 0 when it is not there (the page is not inside Telegram) */
export const versionOf = (hash) => parseFloat(new URLSearchParams(hash.replace(/^#/, '')).get('tgWebAppVersion') || '0') || 0

const PREF = 'sud.fullscreen'

export function createTelegram({ win, hash, storage, doc }) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const version = versionOf(hash)
  const platform = params.get('tgWebAppPlatform') || 'unknown'
  const phone = platform === 'ios' || platform === 'android'
  // fullscreen is a phone thing: on a laptop the page stays in its window (no request, no toggle)
  const can = { fullscreen: version >= 8.0 && phone, safeArea: version >= 8.0, swipe: version >= 7.7 }
  const handlers = new Map()
  const watchers = new Set()
  let fullscreen = false
  let started = false
  let requested = false
  const got = { safe: false, content: false }
  /** the last events the client sent (type + data), for the diagnostics page (`/app?debug=1`) */
  const events = []

  const read = () => { try { return storage.getItem(PREF) } catch { return null } }
  const write = (v) => { try { storage.setItem(PREF, v) } catch { /* private mode: the choice just is not remembered */ } }

  /** one message to the Telegram client */
  function post(type, data = '') {
    try {
      if (win.TelegramWebviewProxy && typeof win.TelegramWebviewProxy.postEvent === 'function') win.TelegramWebviewProxy.postEvent(type, JSON.stringify(data))
      else if (win.parent && win.parent !== win) win.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), '*')
    } catch { /* not inside a client that listens: nothing to tell */ }
  }

  function receive(type, data) {
    let d = data
    if (typeof d === 'string') { try { d = JSON.parse(d) } catch { /* keep the text */ } }
    events.push({ type: String(type), data: JSON.stringify(d ?? null).slice(0, 120) })
    if (events.length > 30) events.shift()
    const fn = handlers.get(type)
    if (fn) fn(d && typeof d === 'object' ? d : {})
  }

  const px = (v) => `${Math.max(0, Math.round(Number(v) || 0))}px`
  /** the safe area is exposed as CSS variables (`--tg-safe-*`, `--tg-content-safe-*`) that the shell's padding reads */
  function insets(kind, d) {
    const root = doc.documentElement
    for (const side of ['top', 'right', 'bottom', 'left']) root.style.setProperty(`--tg-${kind}-${side}`, px(d[side]))
  }

  function setFullscreen(on) {
    fullscreen = on
    doc.documentElement.dataset.fullscreen = on ? '1' : '0'
    // while the page is fullscreen a swipe down must scroll, not close it
    if (can.swipe) post('web_app_setup_swipe_behavior', { allow_vertical_swipe: !on })
    watchers.forEach((fn) => fn(on))
  }

  handlers.set('fullscreen_changed', (d) => {
    setFullscreen(!!d.is_fullscreen)
    if (d.is_fullscreen && !phone) post('web_app_exit_fullscreen') // a laptop client that came up fullscreen (an old choice) is put back in its window
  })
  // `ALREADY_FULLSCREEN` is an answer to a request made when it already was: the state is known, not a failure
  handlers.set('fullscreen_failed', (d) => { if (d.error === 'ALREADY_FULLSCREEN') setFullscreen(true) })
  handlers.set('safe_area_changed', (d) => { got.safe = true; delete doc.documentElement.dataset.safe; insets('safe', d) })
  handlers.set('content_safe_area_changed', (d) => { got.content = true; insets('content-safe', d) })

  // Where the client hands its answers over differs by app: Telegram's own library defines all of these, so a page that does not may hear nothing
  // (Android calls `Telegram.WebView.receiveEvent`, iOS `TelegramGameProxy.receiveEvent`, some builds the flat `TelegramGameProxy_receiveEvent`)
  win.Telegram = win.Telegram || {}
  win.Telegram.WebView = { ...(win.Telegram.WebView || {}), receiveEvent: receive }
  win.TelegramGameProxy = { ...(win.TelegramGameProxy || {}), receiveEvent: receive }
  win.TelegramGameProxy_receiveEvent = receive
  win.addEventListener('message', (e) => {
    if (e.source !== win.parent) return // only the client that frames this page
    try {
      const m = JSON.parse(e.data)
      if (m && typeof m.eventType === 'string') receive(m.eventType, m.eventData)
    } catch { /* not for us */ }
  })

  // ---- when the client does not answer ------------------------------------------------------------------------------------------------------------
  // The layout must stay out of the status bar and Telegram's own buttons even if the answer never comes. After a short wait, on a phone that was asked for
  // fullscreen and whose page really is as tall as the screen, a guess is used (the browser's own `env()` value when it gives one, else a typical one); the
  // client's real numbers replace it the moment they arrive.
  const GUESS = { ios: { top: 52, bottom: 34 }, android: { top: 28, bottom: 0 } }
  const CONTENT_TOP = 56 // the row of Telegram's own buttons (Close, the arrow, the dots) under the status bar
  function envPx(side) {
    try {
      const el = doc.createElement('div')
      el.style.paddingTop = `env(safe-area-inset-${side})`
      doc.body.append(el)
      const v = parseFloat(win.getComputedStyle(el).paddingTop) || 0
      el.remove()
      return v
    } catch { return 0 }
  }
  const tall = () => !!(win.screen && win.screen.height > 0 && win.innerHeight >= win.screen.height - 12)
  function guess() {
    if (got.safe || !phone || !can.fullscreen || !requested || !(fullscreen || tall())) return
    const g = GUESS[platform]
    doc.documentElement.dataset.safe = 'guess'
    insets('safe', { top: envPx('top') || g.top, bottom: envPx('bottom') || g.bottom, left: 0, right: 0 })
    if (!got.content) insets('content-safe', { top: CONTENT_TOP, right: 0, bottom: 0, left: 0 })
  }

  /** does this client's person want fullscreen now: their own earlier choice, else yes on a phone */
  const wanted = () => (read() === '1' ? true : read() === '0' ? false : phone)

  return {
    version, platform, can,
    isFullscreen: () => fullscreen,
    /** called with true/false whenever the fullscreen state changes */
    onFullscreen: (fn) => { watchers.add(fn); return () => watchers.delete(fn) },
    /** the person's button: remembered, so the next launch does the same */
    toggleFullscreen() {
      if (!can.fullscreen) return
      write(fullscreen ? '0' : '1')
      if (!fullscreen) requested = true
      post(fullscreen ? 'web_app_exit_fullscreen' : 'web_app_request_fullscreen')
    },
    /** call once, as soon as the page is up */
    start() {
      if (started || !version) return
      started = true
      post('web_app_ready')
      post('web_app_expand')
      post('web_app_set_header_color', { color_key: 'bg_color' })
      if (can.safeArea) { post('web_app_request_safe_area'); post('web_app_request_content_safe_area') }
      if (can.fullscreen && wanted()) { requested = true; post('web_app_request_fullscreen') }
      if (typeof win.setTimeout === 'function') win.setTimeout(guess, 1500)
    },
    /** what the page knows about the client, for the diagnostics page */
    diagnostics: () => ({ version, platform, can, fullscreen, requested, gotSafe: got.safe, gotContent: got.content, events: events.slice(-12) }),
    /** for tests: what the client would send us, and the fallback guess now */
    receive,
    guess,
  }
}
