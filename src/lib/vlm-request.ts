import 'server-only'
import { checkPublicHost } from '@/lib/net/public-host'
import { validateVlmInput, type VlmInput, type VlmInputError } from '@/core/vlm'
import { readSavedVlm } from './vlm-config'

/**
 * The form's body → a setting the server may use. An empty key field means «keep the saved key» (so a model can be
 * changed without retyping the secret). The base URL's address is resolved and must be a public one: this server
 * sends the key there, so a name that points inside this machine is refused.
 */
export async function readVlmBody(req: Request): Promise<{ ok: true; value: VlmInput } | { ok: false; error: VlmInputError | 'bad_body' | 'private_host'; detail?: string }> {
  let raw: Partial<VlmInput>
  try {
    raw = (await req.json()) as Partial<VlmInput>
  } catch {
    return { ok: false, error: 'bad_body' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_body' }
  const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey : (readSavedVlm()?.apiKey ?? '')
  const v = validateVlmInput({ provider: raw.provider, baseUrl: raw.baseUrl, model: raw.model, apiKey })
  if (!v.ok) return v
  const host = await checkPublicHost(new URL(v.value.baseUrl).hostname)
  if (!host.ok) return { ok: false, error: host.reason === 'private' ? 'private_host' : 'bad_url', detail: host.detail }
  return v
}

export const VLM_ERROR_TEXT: Record<string, string> = {
  bad_body: 'soʻrov notoʻgʻri',
  bad_provider: 'taʼminotchi notoʻgʻri',
  bad_url: 'manzil notoʻgʻri (https va ochiq domen kerak)',
  no_model: 'model nomi kerak',
  no_key: 'API kalit kerak',
  bad_key: 'API kalit notoʻgʻri koʻrinishda (boʻsh joysiz, 8–400 belgi)',
  private_host: 'manzil ichki tarmoqqa ishora qiladi',
}
