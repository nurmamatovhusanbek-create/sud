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
  const can = { fullscreen: version >= 8.0, safeArea: version >= 8.0, swipe: version >= 7.7 }
  const handlers = new Map()
  const watchers = new Set()
  let fullscreen = false
  let started = false

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

  handlers.set('fullscreen_changed', (d) => setFullscreen(!!d.is_fullscreen))
  // `ALREADY_FULLSCREEN` is an answer to a request made when it already was: the state is known, not a failure
  handlers.set('fullscreen_failed', (d) => { if (d.error === 'ALREADY_FULLSCREEN') setFullscreen(true) })
  handlers.set('safe_area_changed', (d) => insets('safe', d))
  handlers.set('content_safe_area_changed', (d) => insets('content-safe', d))

  win.Telegram = win.Telegram || {}
  win.Telegram.WebView = { ...(win.Telegram.WebView || {}), receiveEvent: receive }
  win.addEventListener('message', (e) => {
    if (e.source !== win.parent) return // only the client that frames this page
    try {
      const m = JSON.parse(e.data)
      if (m && typeof m.eventType === 'string') receive(m.eventType, m.eventData)
    } catch { /* not for us */ }
  })

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
      if (can.fullscreen && wanted()) post('web_app_request_fullscreen')
    },
    /** for tests: what the client would send us */
    receive,
  }
}
