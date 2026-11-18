'use client'

/**
 * Settings › Koʻrinish — how the app looks: the look (Premium / Tinch), light or dark, and animations.
 * The look only switches tokens and a CSS layer on <html data-look> (lib/look, app/look-premium.css): the screens are the same.
 */

import { Moon, Palette, Sparkles, Sun } from 'lucide-react'
import { useLook, type Look } from '@/lib/look'
import { useMotion, type Motion } from '@/lib/motion'
import { useTheme } from '@/lib/theme'

const LOOKS: { id: Look; name: string; text: string }[] = [
  { id: 'premium', name: 'Premium', text: 'Toʻq koʻk, fil suyagi rangi va bitta tilla aksent. Sarlavhalarda serif harf. Tinch va nafis.' },
  { id: 'calm', name: 'Tinch', text: 'Kulrang va ingichka chiziqlar, rang faqat maʼno uchun. Eng zich koʻrinish.' },
]

const MOTIONS: { id: Motion; label: string }[] = [
  { id: 'auto', label: 'Tizim sozlamasi' },
  { id: 'on', label: 'Doim yoqilgan' },
  { id: 'off', label: 'Oʻchiq' },
]

/** a miniature of the look: sidebar + three tiles. It carries its own colours (it shows the OTHER look too). */
function Preview({ look }: { look: Look }) {
  return (
    <div className={`look-prev ${look}`} aria-hidden="true">
      <div className="lp-side">
        <i /><i /><i />
      </div>
      <div className="lp-main">
        <b />
        {look === 'premium' ? <u /> : null}
        <div className="lp-tiles"><i /><i /><i /></div>
        <div className="lp-rows"><i /><i /></div>
      </div>
    </div>
  )
}

export function AppearanceTab() {
  const { look, setLook } = useLook()
  const { theme, setTheme } = useTheme()
  const { motion, setMotion } = useMotion()

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
      <div className="p-card">
        <div className="card-h">
          <div className="ico"><Palette /></div>
          <h2>Koʻrinish uslubi</h2>
        </div>
        <div className="look-grid" role="radiogroup" aria-label="Koʻrinish uslubi">
          {LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={look === l.id} className={`look-opt${look === l.id ? ' on' : ''}`} onClick={() => setLook(l.id)}>
              <Preview look={l.id} />
              <span className="lo-name">{l.name}{look === l.id ? ' · tanlangan' : ''}</span>
              <span className="lo-text">{l.text}</span>
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '14px 0 0' }}>
          Ikkala uslubda ham sahifalar va maʼlumotlar bir xil: faqat rang, shakl va bezak almashadi. Tanlov shu brauzerda saqlanadi.
        </p>
      </div>

      <div className="p-card">
        <div className="card-h">
          <div className="ico">{theme === 'dark' ? <Moon /> : <Sun />}</div>
          <h2>Mavzu va animatsiya</h2>
        </div>
        <div className="kv">
          <span className="k">Mavzu</span>
          <div className="seg" role="radiogroup" aria-label="Mavzu">
            <button type="button" role="radio" aria-checked={theme === 'light'} className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Yorugʻ</button>
            <button type="button" role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Qorongʻi</button>
          </div>
        </div>
        <div className="kv">
          <span className="k" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Sparkles style={{ width: 15, height: 15 }} />Animatsiya</span>
          <div className="seg" role="radiogroup" aria-label="Animatsiya">
            {MOTIONS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={motion === m.id} className={motion === m.id ? 'on' : ''} onClick={() => setMotion(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
