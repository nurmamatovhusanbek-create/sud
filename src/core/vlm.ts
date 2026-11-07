/**
 * The captcha reader (a vision language model, «VLM»): the providers the Settings tab offers, how a saved setting is
 * validated, and how a provider's refusal is told apart: a wrong key, a wrong model, a model that cannot take images.
 * Pure (shared by the form and the server); the network lives in lib/vlm-client.ts.
 */

export type VlmProvider = 'zai' | 'groq' | 'gemini' | 'custom'

export interface VlmPreset {
  provider: VlmProvider
  label: string
  /** OpenAI-compatible base URL: `<baseUrl>/chat/completions` */
  baseUrl: string
  /** a vision model that is a sensible first choice (editable: providers rename models) */
  model: string
  /** where the operator makes a key */
  keyPage: string
  note: string
}

export const VLM_PRESETS: readonly VlmPreset[] = [
  {
    provider: 'zai', label: 'Z.ai (GLM)', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6v-flash', keyPage: 'z.ai → API keys',
    note: 'GLM-4.6V-Flash — bepul vision modeli (Z.ai hujjatlarida tekshiring: model nomlari oʻzgarib turadi).',
  },
  {
    provider: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b', keyPage: 'console.groq.com → API Keys',
    note: 'Qwen 3.8 27B — rasm oʻqiy oladi (haqiqiy kalit bilan sinalgan). Groq modellarni almashtirib turadi: «Sinash» rad etsa, console.groq.com/docs/models dan vision modelini tanlang. Bepul darajada cheklov bor.',
  },
  {
    provider: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash-lite', keyPage: 'aistudio.google.com → Get API key',
    note: 'Gemini 3.5 Flash-Lite rasm oʻqiydi (haqiqiy kalit bilan sinalgan, ~1 soniya). Google eski modellarni yangi foydalanuvchilardan yopib turadi: «Sinash» rad etsa, ai.google.dev dan joriy modelni tanlang. Bepul daraja limitlarini ham oʻsha yerda tekshiring.',
  },
  {
    provider: 'custom', label: 'Boshqa (OpenAI-mos)', baseUrl: '', model: '', keyPage: '',
    note: 'Istalgan OpenAI-mos «chat/completions» manzili va rasm qabul qiladigan model (OpenRouter, OpenAI, Together…).',
  },
]

export const presetOf = (p: VlmProvider): VlmPreset => VLM_PRESETS.find((x) => x.provider === p) ?? VLM_PRESETS[2]

export interface VlmInput {
  provider: VlmProvider
  baseUrl: string
  model: string
  apiKey: string
}

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

/** A base URL the server may call: https, a public DNS name, no credentials / query / fragment. Returns it without a trailing slash. */
export function normalizeBaseUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null
  const h = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!HOST.test(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /\.(local|internal|lan|localdomain|home|corp|intranet)$/.test(h)) return null
  return (u.origin + u.pathname).replace(/\/+$/, '')
}

export type VlmInputError = 'bad_provider' | 'bad_url' | 'no_model' | 'no_key' | 'bad_key'

/** Validate what the form sends. A key must be one printable token (no spaces, no line breaks); its value is never judged further. */
export function validateVlmInput(i: Partial<VlmInput>): { ok: true; value: VlmInput } | { ok: false; error: VlmInputError } {
  const provider = i.provider
  if (provider !== 'zai' && provider !== 'groq' && provider !== 'gemini' && provider !== 'custom') return { ok: false, error: 'bad_provider' }
  const baseUrl = normalizeBaseUrl(i.baseUrl ?? '')
  if (!baseUrl) return { ok: false, error: 'bad_url' }
  const model = (i.model ?? '').trim()
  if (!model || model.length > 120 || /\s/.test(model)) return { ok: false, error: 'no_model' }
  const apiKey = (i.apiKey ?? '').trim()
  if (!apiKey) return { ok: false, error: 'no_key' }
  if (apiKey.length < 8 || apiKey.length > 400 || /\s/.test(apiKey) || /[^\x21-\x7e]/.test(apiKey)) return { ok: false, error: 'bad_key' }
  return { ok: true, value: { provider, baseUrl, model, apiKey } }
}

/** One saved provider is identified by its kind (a custom endpoint by its host): saving it again replaces it, a different one is added. */
export const vlmId = (v: Pick<VlmInput, 'provider' | 'baseUrl'>): string => {
  if (v.provider !== 'custom') return v.provider
  try {
    return `custom:${new URL(v.baseUrl).hostname.toLowerCase()}`
  } catch {
    return 'custom'
  }
}

/** «sk-…abcd» for display: never more than the last four characters. */
export const keyHint = (key: string): string => (key.length > 8 ? `••••${key.slice(-4)}` : '••••')

// ---- what a provider's answer means -------------------------------------------------------------------------------------

export type VlmFailure =
  | 'bad_key' // 401 / 403: the key is not accepted
  | 'bad_model' // 404 / «model not found»
  | 'not_vision' // the key works, the model does not take images
  | 'rate_limited' // 429: out of quota / too fast (the key itself is fine)
  | 'http_error' // anything else the provider answered
  | 'network' // no answer at all
  | 'timeout'
  | 'empty' // answered, but without text

/** Classify a non-2xx answer by its status and its own message. */
export function classifyVlmHttp(status: number, body: string): VlmFailure {
  const b = body.toLowerCase()
  if (status === 401 || status === 403) return 'bad_key'
  if (status === 429) return 'rate_limited'
  if (/(model|модель).{0,60}(not found|does not exist|doesn't exist|unknown|invalid|not exist|decommissioned|no longer supported)|no such model|unknown model/.test(b) || status === 404) return 'bad_model'
  if (/image|vision|multimodal|multi-modal|modalit|image_url|content.{0,20}(type|part)|does not support|not support|unsupported/.test(b) && status >= 400 && status < 500) return 'not_vision'
  return 'http_error'
}
