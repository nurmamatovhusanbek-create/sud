import 'server-only'
import { classifyVlmHttp, type VlmFailure, type VlmInput } from '@/core/vlm'

/**
 * One vision call to any OpenAI-compatible «chat/completions» API (Z.ai, Groq, OpenRouter, OpenAI…): an image and a
 * question in, a short text answer out. The caller picks the provider; this only speaks the common protocol.
 */

export class VlmError extends Error {
  constructor(public kind: VlmFailure, message: string, public status?: number) {
    super(message)
  }
}

export interface VisionRequest {
  imageBase64: string
  prompt: string
  timeoutMs?: number
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** Z.ai's models think before answering unless told not to (a captcha needs one number, fast); other providers reject the field. */
const isZai = (baseUrl: string): boolean => /(^|\.)z\.ai$/i.test(new URL(baseUrl).hostname) || /bigmodel\.cn$/i.test(new URL(baseUrl).hostname)

/** Gemini 2.5 «thinks» before answering and its thinking tokens count against max_tokens (a tiny limit gives an empty answer): switch it off. */
const isGemini = (baseUrl: string): boolean => new URL(baseUrl).hostname.toLowerCase() === 'generativelanguage.googleapis.com'

export async function callVision(cfg: Pick<VlmInput, 'baseUrl' | 'model' | 'apiKey'>, req: VisionRequest, fetchImpl: Fetch = fetch): Promise<string> {
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: req.prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${req.imageBase64}` } },
        ],
      },
    ],
    max_tokens: isGemini(cfg.baseUrl) ? 256 : 24,
    temperature: 0,
    ...(isZai(cfg.baseUrl) ? { thinking: { type: 'disabled' } } : {}),
    ...(isGemini(cfg.baseUrl) ? { reasoning_effort: 'none' } : {}),
  }
  let res: Response
  try {
    res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
      redirect: 'manual', // a provider that answers 3xx must not steer the key to another host
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new VlmError('timeout', 'javob kelmadi (vaqt tugadi)')
    throw new VlmError('network', e instanceof Error ? e.message : 'tarmoq xatosi')
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new VlmError(classifyVlmHttp(res.status, text), providerMessage(text) || `HTTP ${res.status}`, res.status)
  let answer = ''
  try {
    const j = JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] }
    const c = j.choices?.[0]?.message?.content
    answer = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join('') : ''
  } catch {
    /* not JSON */
  }
  if (!answer.trim()) throw new VlmError('empty', 'model javob qaytarmadi')
  return answer
}

/** The provider's own explanation (never the key: it is not in a response), cut short. */
function providerMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message
    if (m) return String(m).slice(0, 200)
  } catch {
    /* not JSON */
  }
  return body.replace(/\s+/g, ' ').slice(0, 200)
}
