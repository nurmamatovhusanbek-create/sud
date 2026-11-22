// A tiny DOM builder. Text is ALWAYS set as text (never as HTML), so data from the backup cannot inject markup. No inline styles (the CSP forbids them).
const SVG = 'http://www.w3.org/2000/svg'

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv
    else if (k in el && k !== 'list') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  append(el, kids)
  return el
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue
    el.append(k instanceof Node ? k : document.createTextNode(String(k)))
  }
  return el
}

export function svg(paths, size = 20) {
  const s = document.createElementNS(SVG, 'svg')
  s.setAttribute('width', size)
  s.setAttribute('height', size)
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('fill', 'none')
  s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '1.8')
  s.setAttribute('stroke-linecap', 'round')
  s.setAttribute('stroke-linejoin', 'round')
  s.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', d)
    s.append(p)
  }
  return s
}
