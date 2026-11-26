// The loading screen's controls (markup and styles: index.html, css/components/splash.css). It is up from the first byte; it goes when the first screen is drawn.
import { h } from '../ui/h.js'
import { Button } from '../ui/components.js'

const el = (id) => document.getElementById(id)

/** the one line under the bar: what is being waited for */
export function splashText(text) {
  const m = el('splash-msg')
  if (m) m.textContent = text
}

/** fade out and remove */
export function splashDone() {
  const s = el('splash')
  if (!s) return
  s.classList.add('splash--leave')
  setTimeout(() => s.remove(), 260) // the fade is 200 ms (0 with reduced motion): removed either way
}

/** the bar stops, the line says why, a button tries again */
export function splashFail(message, onRetry) {
  const s = el('splash')
  if (!s) return
  s.classList.add('splash--failed')
  splashText(message)
  el('splash-more')?.replaceChildren(h('div', {}, Button({ label: 'Qayta urinish', variant: 'primary', onClick: onRetry })))
}
