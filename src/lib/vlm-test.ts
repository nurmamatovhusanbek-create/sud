import 'server-only'
import { callVision, VlmError } from './vlm-client'
import { mathImage, type MathImage } from './vlm-test-image'
import type { VlmFailure, VlmInput } from '@/core/vlm'

/**
 * «Does this key work, and can this model READ an image?» — answered by asking it two small arithmetic pictures whose
 * answers we know. A key that is accepted but a model that takes no images is told apart from a wrong key, so the
 * operator sees what to change. The same prompt the captcha solver uses, so a pass means the solver will work too.
 */

export const MATH_PROMPT =
  'This image shows a simple arithmetic problem (addition, subtraction, multiplication or division of integers). Read the expression and calculate the result. Reply with ONLY the integer result, no words, no explanation. For example if the image shows "12 + 7 =" reply "19".'

/** the first integer in a model's answer, or null */
export const parseIntegerAnswer = (text: string): number | null => {
  const m = /-?\d+/.exec(text)
  return m ? parseInt(m[0], 10) : null
}

export interface VlmTestResult {
  ok: boolean
  /** why not (when !ok) */
  reason?: VlmFailure | 'weak'
  detail?: string
  /** pictures read correctly / asked */
  correct: number
  asked: number
  ms: number
}

type Caller = typeof callVision

export async function testVision(cfg: Pick<VlmInput, 'baseUrl' | 'model' | 'apiKey'>, opts: { call?: Caller; images?: MathImage[] } = {}): Promise<VlmTestResult> {
  const call = opts.call ?? callVision
  // numbers differ on every test, so a model cannot pass on a remembered answer
  const r = () => 3 + Math.floor(Math.random() * 40)
  const images = opts.images ?? [mathImage(r(), '+', r()), mathImage(r() + 20, '-', r() % 19)]
  const t0 = Date.now()
  let correct = 0
  for (const img of images) {
    try {
      const text = await call(cfg, { imageBase64: img.pngBase64, prompt: MATH_PROMPT, timeoutMs: 25_000 })
      if (parseIntegerAnswer(text) === img.answer) correct++
    } catch (e) {
      const err = e instanceof VlmError ? e : null
      return { ok: false, reason: err?.kind ?? 'http_error', detail: err?.message ?? (e instanceof Error ? e.message : String(e)), correct, asked: images.length, ms: Date.now() - t0 }
    }
  }
  const ms = Date.now() - t0
  if (correct === images.length) return { ok: true, correct, asked: images.length, ms }
  return { ok: false, reason: 'weak', detail: 'model rasmni qabul qildi, lekin hisoblagan javoblari notoʻgʻri', correct, asked: images.length, ms }
}
