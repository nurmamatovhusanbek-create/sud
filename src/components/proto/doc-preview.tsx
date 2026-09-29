'use client'

/**
 * Live .docx preview — renders the REAL template (letterhead, fonts, layout)
 * filled with the current form values, next to the form.
 *
 * Pipeline per change (debounced): reload the template zip → markXml() fills
 * every {{key}} with the value wrapped in sentinels → swap the letterhead the
 * same way the server does → docx-preview renders it off-screen → sentinels are
 * re-wrapped into <span class="slot" data-k> so values are clickable → the
 * finished DOM is swapped in (scroll position preserved, no flicker).
 *
 * The fill is fill.shared.ts — the exact function the server download uses.
 */

import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { Loader2, TriangleAlert } from 'lucide-react'
import { fetchDocTemplate } from '@/lib/api-client'
import { BLANK_PNG_B64, MARK_OPEN, MARK_RE, markXml } from '@/lib/documents/fill.shared'
import { FIELDS } from '@/lib/documents/registry'

interface Tpl {
  docId: string
  buf: ArrayBuffer
  xml: string
  hasBanner: boolean
}

const RENDER_OPTS = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  useBase64URL: true, // images as data: URLs — CSP allows img-src data:
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: false,
  renderEndnotes: false,
  renderComments: false,
  renderChanges: false,
} as const

function b64ToBytes(b64: string): Uint8Array {
  const raw = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  const bin = atob(raw)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// An empty spot shows the field's example text (e.g. «Toshkent tumanlararo
// iqtisodiy sud»), which reads like the finished sentence; the label is the
// fallback for fields with no example. Tooltips always use the label.
const labelOf = (key: string) => FIELDS[key]?.label ?? key
const hintOf = (key: string) => FIELDS[key]?.placeholder || labelOf(key)

/** Turn sentinel-wrapped values in the rendered DOM into clickable field spans. */
function decorate(root: HTMLElement, activeKey: string | null): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.includes(MARK_OPEN)) hits.push(n as Text)
  }
  for (const t of hits) {
    const s = t.data
    const frag = document.createDocumentFragment()
    let last = 0
    MARK_RE.lastIndex = 0
    for (let m = MARK_RE.exec(s); m; m = MARK_RE.exec(s)) {
      if (m.index > last) frag.append(s.slice(last, m.index))
      const span = document.createElement('span')
      span.className = `slot ${m[1] ? 'empty' : 'filled'}${m[2] === activeKey ? ' active' : ''}`
      span.dataset.k = m[2]
      span.title = labelOf(m[2])
      span.textContent = m[3]
      frag.append(span)
      last = m.index + m[0].length
    }
    if (last < s.length) frag.append(s.slice(last))
    t.replaceWith(frag)
  }
}

export function DocPreview({
  docId, values, letterhead, blank, activeKey, onPick,
}: {
  docId: string
  values: Record<string, string>
  /** uploaded banner (base64 PNG) or '' */
  letterhead: string
  /** when no banner is uploaded, blank the template's embedded one (as the download does) */
  blank: boolean
  activeKey: string | null
  onPick: (key: string) => void
}) {
  const [tpl, setTpl] = useState<Tpl | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const activeRef = useRef(activeKey)

  // ---- fit the page to the canvas width
  const fit = () => {
    const c = canvasRef.current
    const host = hostRef.current
    const page = host?.querySelector<HTMLElement>('section.docx')
    if (!c || !host || !page) return
    host.style.zoom = '1'
    const w = page.getBoundingClientRect().width
    if (!w) return
    host.style.zoom = String(Math.max(0.45, Math.min(1.3, (c.clientWidth - 40) / w)))
  }

  // ---- load the template when the document changes
  useEffect(() => {
    let dead = false
    setTpl(null)
    setErr(null)
    setReady(false)
    fetchDocTemplate(docId)
      .then(async (buf) => {
        const zip = await JSZip.loadAsync(buf)
        const f = zip.file('word/document.xml')
        if (!f) throw new Error('Shablon buzilgan')
        const xml = await f.async('string')
        if (!dead) setTpl({ docId, buf, xml, hasBanner: !!zip.file('word/media/image1.png') })
      })
      .catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : 'Shablonni yuklab boʻlmadi') })
    return () => { dead = true }
  }, [docId])

  // ---- (re)render on every change, debounced
  useEffect(() => {
    if (!tpl) return
    const id = ++seq.current
    const t = setTimeout(async () => {
      try {
        const z = await JSZip.loadAsync(tpl.buf)
        z.file('word/document.xml', markXml(tpl.xml, values, hintOf))
        if (tpl.hasBanner) {
          const png = letterhead || (blank ? BLANK_PNG_B64 : '')
          if (png) z.file('word/media/image1.png', b64ToBytes(png))
        }
        const bytes = await z.generateAsync({ type: 'uint8array', compression: 'STORE' })
        if (id !== seq.current) return

        const { renderAsync } = await import('docx-preview')
        const stage = stageRef.current
        const host = hostRef.current
        const canvas = canvasRef.current
        if (!stage || !host || !canvas) return
        stage.replaceChildren()
        await renderAsync(bytes, stage, stage, RENDER_OPTS)
        if (id !== seq.current) return

        decorate(stage, activeRef.current)
        const keep = canvas.scrollTop
        host.replaceChildren(...Array.from(stage.childNodes))
        fit()
        canvas.scrollTop = keep
        setReady(true)
        setErr(null)
      } catch (e) {
        if (id === seq.current) setErr(e instanceof Error ? e.message : 'Koʻrinishni chizib boʻlmadi')
      }
    }, ready ? 110 : 0)
    return () => clearTimeout(t)
  }, [tpl, values, letterhead, blank])

  // ---- highlight + reveal the focused field's spots
  useEffect(() => {
    activeRef.current = activeKey
    const host = hostRef.current
    if (!host) return
    host.querySelectorAll('.slot.active').forEach((el) => el.classList.remove('active'))
    if (!activeKey) return
    const hits = host.querySelectorAll<HTMLElement>(`.slot[data-k="${activeKey}"]`)
    hits.forEach((el) => el.classList.add('active'))
    hits[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  // ---- refit when the pane resizes
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="dprev" ref={canvasRef}>
      <div
        ref={hostRef}
        className="dprev-host"
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('.slot[data-k]')
          if (el?.dataset.k) onPick(el.dataset.k)
        }}
      />
      {/* off-screen staging area: render here, then swap into the host */}
      <div ref={stageRef} className="dprev-stage" aria-hidden />
      {!ready && !err && (
        <div className="dprev-state"><Loader2 className="spin" style={{ width: 18, height: 18 }} />Hujjat yuklanmoqda…</div>
      )}
      {err && (
        <div className="dprev-state dprev-err"><TriangleAlert style={{ width: 18, height: 18 }} />{err}</div>
      )}
    </div>
  )
}
