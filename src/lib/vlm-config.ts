import 'server-only'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '@/server/config'
import { keyHint, validateVlmInput, vlmId, type VlmInput, type VlmProvider } from '@/core/vlm'

/**
 * The captcha readers (vision models, «VLM») the operator saved in Settings. Each person who runs the app brings their
 * own keys, so they live with THEM, outside the project and never in git: `~/.sud-tizimi/vlm.json` (0600, folder 0700;
 * `VLM_CONFIG_FILE` overrides). SEVERAL providers can be saved: the solver takes them in turn and falls over to the next
 * when one fails (lib/vlm-pool.ts). A key is never sent back to the browser (only its last four characters), and a key
 * set in the environment (VLM_API_KEY + VLM_BASE_URL) still works when nothing is saved.
 * File: `{ providers: [...] }`; the first version wrote ONE provider as a bare object, which is still read.
 */

export const vlmFile = (): string => process.env.VLM_CONFIG_FILE || path.join(os.homedir(), '.sud-tizimi', 'vlm.json')

export function readSavedVlmList(): VlmInput[] {
  try {
    const raw = JSON.parse(fs.readFileSync(vlmFile(), 'utf8')) as { providers?: unknown } & Partial<VlmInput>
    const items: Partial<VlmInput>[] = Array.isArray(raw.providers) ? (raw.providers as Partial<VlmInput>[]) : [raw]
    const out: VlmInput[] = []
    for (const it of items) {
      const v = validateVlmInput(it ?? {})
      if (v.ok && !out.some((o) => vlmId(o) === vlmId(v.value))) out.push(v.value)
    }
    return out
  } catch {
    return []
  }
}

/** the saved provider with this id (for «keep the saved key» when a form is sent without one) */
export const savedVlm = (id: string): VlmInput | null => readSavedVlmList().find((v) => vlmId(v) === id) ?? null

function writeList(list: VlmInput[]): void {
  const file = vlmFile()
  if (!list.length) {
    fs.rmSync(file, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ providers: list, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file) // never a half-written key
}

/** add a provider, or replace the saved one with the same id (keeping its place in the list) */
export function upsertVlm(v: VlmInput): void {
  const list = readSavedVlmList()
  const i = list.findIndex((x) => vlmId(x) === vlmId(v))
  if (i >= 0) list[i] = v
  else list.push(v)
  writeList(list)
}

/** forget one provider (by id), or all of them */
export function removeVlm(id?: string): void {
  try {
    writeList(id ? readSavedVlmList().filter((v) => vlmId(v) !== id) : [])
  } catch {
    /* nothing to remove */
  }
}

export interface VlmProviderStatus {
  id: string
  provider: VlmProvider
  baseUrl: string
  model: string
  keyHint: string
}

export interface VlmStatus {
  configured: boolean
  /** 'saved' = Settings, 'env' = VLM_API_KEY / VLM_BASE_URL, 'none' */
  source: 'saved' | 'env' | 'none'
  providers: VlmProviderStatus[]
  /** the environment's key, shown when nothing is saved */
  env?: { baseUrl: string; keyHint: string }
}

export function vlmStatus(): VlmStatus {
  const saved = readSavedVlmList()
  if (saved.length) {
    return { configured: true, source: 'saved', providers: saved.map((v) => ({ id: vlmId(v), provider: v.provider, baseUrl: v.baseUrl, model: v.model, keyHint: keyHint(v.apiKey) })) }
  }
  const env = config.vlm
  if (env.apiKey.trim() && env.baseUrl.trim()) return { configured: true, source: 'env', providers: [], env: { baseUrl: env.baseUrl.trim(), keyHint: keyHint(env.apiKey.trim()) } }
  return { configured: false, source: 'none', providers: [] }
}
