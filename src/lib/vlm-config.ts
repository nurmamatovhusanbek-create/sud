import 'server-only'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '@/server/config'
import { keyHint, validateVlmInput, type VlmInput, type VlmProvider } from '@/core/vlm'

/**
 * The captcha reader's setting the operator saved in Settings. Each person who runs the app brings their own key, so it
 * lives with THEM, outside the project and never in git: `~/.sud-tizimi/vlm.json` (0600, folder 0700; `VLM_CONFIG_FILE`
 * overrides). The key is never sent back to the browser (only its last four characters), and a key set in the
 * environment (VLM_API_KEY + VLM_BASE_URL) still works as the fallback.
 */

export const vlmFile = (): string => process.env.VLM_CONFIG_FILE || path.join(os.homedir(), '.sud-tizimi', 'vlm.json')

export function readSavedVlm(): VlmInput | null {
  try {
    const raw = JSON.parse(fs.readFileSync(vlmFile(), 'utf8')) as Partial<VlmInput>
    const v = validateVlmInput(raw)
    return v.ok ? v.value : null
  } catch {
    return null
  }
}

export function saveVlm(v: VlmInput): void {
  const file = vlmFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...v, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file) // never a half-written key
}

export function clearSavedVlm(): void {
  try {
    fs.rmSync(vlmFile(), { force: true })
  } catch {
    /* nothing to remove */
  }
}

export interface VlmStatus {
  configured: boolean
  /** 'saved' = Settings, 'env' = VLM_API_KEY / VLM_BASE_URL, 'none' */
  source: 'saved' | 'env' | 'none'
  provider?: VlmProvider
  baseUrl?: string
  model?: string
  keyHint?: string
}

export function vlmStatus(): VlmStatus {
  const saved = readSavedVlm()
  if (saved) return { configured: true, source: 'saved', provider: saved.provider, baseUrl: saved.baseUrl, model: saved.model, keyHint: keyHint(saved.apiKey) }
  const env = config.vlm
  if (env.apiKey.trim() && env.baseUrl.trim()) return { configured: true, source: 'env', baseUrl: env.baseUrl.trim(), keyHint: keyHint(env.apiKey.trim()) }
  return { configured: false, source: 'none' }
}
