// The diagnostics panel: open the Mini App with `?debug=1` (the bot's /debug command sends the button). It shows what Telegram told the page (version, platform,
// fullscreen, the safe areas and the last events), so a layout that sits under the status bar or Telegram's buttons can be explained from a screenshot.
import { h } from '../ui/h.js'
import { telegram } from './telegram.js'

export function mountDebug() {
  if (!new URLSearchParams(location.search).has('debug')) return
  const box = h('pre', { class: 'debug', 'aria-hidden': 'true' })
  document.body.append(box)
  const css = () => getComputedStyle(document.documentElement)
  const v = (name) => css().getPropertyValue(name).trim() || '-'
  const tick = () => {
    const d = telegram.diagnostics()
    box.textContent = [
      `Telegram ${d.version || '-'} · ${d.platform} · fullscreen ${d.fullscreen ? 'ha' : 'yoq'} (soraldi: ${d.requested ? 'ha' : 'yoq'})`,
      `javob: xavfsiz ${d.gotSafe ? 'ha' : 'yoq'} · kontent ${d.gotContent ? 'ha' : 'yoq'} · taxmin: ${document.documentElement.dataset.safe || 'yoq'}`,
      `safe  t${v('--tg-safe-top')} b${v('--tg-safe-bottom')} l${v('--tg-safe-left')} r${v('--tg-safe-right')}`,
      `kont. t${v('--tg-content-safe-top')} b${v('--tg-content-safe-bottom')}`,
      `inset t${v('--inset-top')} b${v('--inset-bottom')} · ${innerWidth}x${innerHeight} / ${screen.width}x${screen.height}`,
      ...d.events.map((e) => `${e.type} ${e.data}`),
    ].join('\n')
  }
  tick()
  setInterval(tick, 700)
}
