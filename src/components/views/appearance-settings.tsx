'use client'

/**
 * Settings › Koʻrinish — which interface the operator works in, the theme, and the new look's folded sidebar.
 * The two looks are complete and equal: «Yangi» (app/ui-new.css) and «Klassik» (the v18 look, unchanged).
 * A click applies at once and is remembered in this browser (lib/ui-version.ts); nothing is sent to the server.
 */

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Check, Moon, PanelLeft, Sun } from 'lucide-react'
import { toast } from 'sonner'
import type { UiVersion } from '@/core/ui-version'
import { setSideMini, setUiVersion, useSideMini, useUiVersion } from '@/lib/ui-version'

const LOOKS: { key: UiVersion; title: string; note: string }[] = [
  { key: 'new', title: 'Yangi', note: 'Zichroq roʻyxatlar, yigʻiladigan yon menyu, aniq fokus chizigʻi' },
  { key: 'classic', title: 'Klassik', note: 'Avvalgi koʻrinish, hech narsa oʻzgarmagan' },
]

const noopSubscribe = () => () => {}

/** A sketch of the screen (sidebar + rows) in the look it stands for; drawn with fixed shapes, not live data. */
function LookSketch({ look }: { look: UiVersion }) {
  const rows = look === 'new' ? 5 : 3
  return (
    <span className={`look-sketch ${look}`} aria-hidden>
      <span className="ls-side">
        <i className="on" />
        <i />
        <i />
      </span>
      <span className="ls-main">
        <span className="ls-top" />
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="ls-row" />
        ))}
      </span>
    </span>
  )
}

export function AppearanceSettings() {
  const ui = useUiVersion()
  const mini = useSideMini()
  const { theme, setTheme } = useTheme()
  // the stored choices are only known in the browser: mark nothing as chosen until then
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const dark = theme === 'dark'

  const pick = (next: UiVersion) => {
    if (next === ui) return
    setUiVersion(next)
    toast.success(next === 'new' ? 'Yangi koʻrinish yoqildi' : 'Klassik koʻrinish qaytarildi')
  }

  return (
    <div className="p-grid rise-c">
      <div className="p-card">
        <div className="card-h">
          <div className="ico">
            <PanelLeft />
          </div>
          <h3>Interfeys</h3>
          <span className="sp" />
          <span className="faint" style={{ fontSize: 12 }}>Shu brauzerda saqlanadi</span>
        </div>
        <div className="look-grid" role="radiogroup" aria-label="Interfeys koʻrinishi">
          {LOOKS.map((l) => {
            const on = hydrated && ui === l.key
            return (
              <button key={l.key} type="button" role="radio" aria-checked={on} className={`look-opt ${on ? 'on' : ''}`} data-look={l.key} onClick={() => pick(l.key)}>
                <LookSketch look={l.key} />
                <span className="look-txt">
                  <b>{l.title}</b>
                  <span>{l.note}</span>
                </span>
                <span className="look-check" aria-hidden>
                  {on && <Check />}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-card">
        <div className="look-line">
          <span className="look-line-t">
            <b>Mavzu</b>
            <span>Yorugʻ yoki qorongʻi ranglar</span>
          </span>
          <div className="seg" role="radiogroup" aria-label="Mavzu">
            <button type="button" role="radio" aria-checked={hydrated && !dark} className={hydrated && !dark ? 'on' : ''} onClick={() => setTheme('light')}>
              <Sun style={{ width: 14, height: 14, display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
              Yorugʻ
            </button>
            <button type="button" role="radio" aria-checked={hydrated && dark} className={hydrated && dark ? 'on' : ''} onClick={() => setTheme('dark')}>
              <Moon style={{ width: 14, height: 14, display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
              Qorongʻi
            </button>
          </div>
        </div>
        {hydrated && ui === 'new' && (
          <div className="look-line">
            <span className="look-line-t">
              <b>Yon menyuni yigʻish</b>
              <span>Faqat belgilar qoladi, sahifaga koʻproq joy</span>
            </span>
            <button type="button" role="switch" aria-checked={mini} aria-label="Yon menyuni yigʻish" className={`toggle ${mini ? 'on' : ''}`} onClick={() => setSideMini(!mini)} />
          </div>
        )}
      </div>
    </div>
  )
}
