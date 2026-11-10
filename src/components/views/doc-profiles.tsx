'use client'

/**
 * «Saqlanganlar» for one section of a document form: pick a saved company / person to fill the section's fields, or
 * save what is typed now under a name. The group is the section's field set, so a profile saved in one document is
 * offered by every section with the same fields (lib/documents/profiles.ts). Compact on purpose: nothing but a select
 * (only when something is saved) and one small button.
 */

import { useState } from 'react'
import { Bookmark, Check, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { applyProfile, deleteProfile, listProfiles, profileNs, profileValues, saveProfile, suggestName, type Profile } from '@/lib/documents/profiles'

const store = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function SectionProfiles({ keys, values, onApply }: {
  keys: string[]
  values: Record<string, string>
  onApply: (next: Record<string, string>) => void
}) {
  const ns = profileNs(keys)
  const [list, setList] = useState<Profile[]>(() => {
    const s = store()
    return s ? listProfiles(s, ns) : []
  })
  const [naming, setNaming] = useState<string | null>(null)
  const [picked, setPicked] = useState('')
  const refresh = () => {
    const s = store()
    setList(s ? listProfiles(s, ns) : [])
  }
  const filled = Object.keys(profileValues(keys, values)).length > 0
  if (keys.length < 2) return null

  const confirm = () => {
    const s = store()
    if (!s || naming === null) return
    const p = saveProfile(s, ns, keys, naming, values)
    if (!p) {
      toast.error('Nom va kamida bitta toʻldirilgan maydon kerak')
      return
    }
    setNaming(null)
    refresh()
    toast.success(`«${p.name}» saqlandi`)
  }

  if (naming !== null) {
    return (
      <span className="dedit-prof">
        <input
          className="dinput"
          autoFocus
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm()
            if (e.key === 'Escape') setNaming(null)
          }}
          placeholder="Nom"
          aria-label="Saqlanadigan nom"
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={confirm} aria-label="Saqlash"><Check /></button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(null)} aria-label="Bekor qilish"><X /></button>
      </span>
    )
  }

  const current = list.find((p) => p.id === picked)
  return (
    <span className="dedit-prof">
      {list.length > 0 && (
        <select
          className="dinput"
          value={picked}
          aria-label="Saqlanganlardan tanlash"
          onChange={(e) => {
            const p = list.find((x) => x.id === e.target.value)
            setPicked(e.target.value)
            if (p) onApply(applyProfile(values, keys, p))
          }}
        >
          <option value="">Saqlanganlar ({list.length})</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      {current && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Saqlanganni oʻchirish"
          title={`«${current.name}» ni oʻchirish`}
          onClick={() => {
            const s = store()
            if (s) deleteProfile(s, ns, current.id)
            setPicked('')
            refresh()
          }}
        >
          <Trash2 />
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm" disabled={!filled} onClick={() => setNaming(suggestName(keys, values))} title={filled ? 'Shu maydonlarni nom bilan saqlash' : 'Avval maydonlarni toʻldiring'}>
        <Bookmark />
        <span>Saqlash</span>
      </button>
    </span>
  )
}
