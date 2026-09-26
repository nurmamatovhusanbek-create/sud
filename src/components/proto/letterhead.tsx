'use client'

/**
 * Shared per-company letterhead picker used by the document engine and the
 * Talabnoma flow. The image is re-encoded to a bounded PNG in the browser
 * (canvas) so the server never needs an image toolchain; the base64 is cached
 * in localStorage and swapped into the template's embedded banner at fill time.
 */

import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'

export const LH_KEY = 'sud-doc-letterhead-v1'

/** Read a file and re-encode it to a bounded PNG via canvas, entirely in the
 *  browser — the server then never needs an image toolchain (no native deps). */
export async function fileToPng(file: File, maxW = 1600): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(new Error('read'))
    r.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('img'))
    i.src = dataUrl
  })
  const iw = img.width || maxW
  const ih = img.height || 1
  const scale = Math.min(1, maxW / iw)
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png')
}

/** localStorage-backed letterhead state, shared across the doc surfaces. */
export function useLetterhead(): [string, (v: string) => void] {
  const [letterhead, setLetterhead] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem(LH_KEY) || '' } catch { return '' }
  })
  const update = (v: string) => {
    setLetterhead(v)
    try {
      if (v) localStorage.setItem(LH_KEY, v)
      else localStorage.removeItem(LH_KEY)
    } catch { /* private mode / quota */ }
  }
  return [letterhead, update]
}

export function LetterheadRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = async (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { toast.error('Rasm fayl tanlang (PNG/JPG)'); return }
    if (f.size > 8 * 1024 * 1024) { toast.error('Rasm juda katta (maks 8MB)'); return }
    try {
      onChange(await fileToPng(f))
      toast.success('Blanka yuklandi')
    } catch {
      toast.error('Rasmni oʻqib boʻlmadi')
    }
  }

  return (
    <div className="lh-row">
      <div className="lh-prev">
        {value
          ? <img src={value} alt="Korxona blankasi" />
          : <div className="lh-empty"><ImagePlus /><span>Blanka yoʻq — boʻsh joy qoldiriladi</span></div>}
      </div>
      <div className="lh-ctl">
        <span className="doc-field-label">Korxona blankasi (letterhead)</span>
        <div className="faint" style={{ fontSize: 12, margin: '4px 0 10px', lineHeight: 1.4 }}>
          Yuklanmasa, hujjat tepasida blanka uchun boʻsh joy qoldiriladi. Keng banner tavsiya etiladi (masalan 1600×420 px).
        </div>
        <div className="p-row" style={{ gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus />{value ? 'Almashtirish' : 'Rasm yuklash'}
          </button>
          {value && (
            <button className="btn btn-ghost btn-sm" onClick={() => { onChange(''); toast('Blanka olib tashlandi') }}>
              <X />Olib tashlash
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0] || null)} />
      </div>
    </div>
  )
}
