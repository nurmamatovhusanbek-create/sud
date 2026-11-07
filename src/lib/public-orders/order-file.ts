/**
 * Order file download with public.sud.uz's captcha token (pure: the network is injected, so it is tested without one).
 *
 * The token is single-use, so ONE worker mints it and sends the download, unhedged; a refused token is retried once from
 * a different worker (different egress). Any other failure is not retried: it would spend a second captcha for nothing.
 */

/** Upstream's refusal of a missing / spent / wrong captcha token: HTTP 403 {"message":"Каптча тасдиқланмади"}. */
export const isCaptchaRefusal = (status: number, body: string): boolean => status === 403 && /капт?ча|captcha/i.test(body)

export interface OrderFileDeps {
  /** mint a download token, the whole session on `worker` */
  getToken: (worker: string | undefined) => Promise<string>
  /** GET the file with that token from `worker` (no hedge: the token is single-use) */
  download: (pdfId: string, token: string, worker: string | undefined) => Promise<{ status: number; body: Uint8Array }>
  pick: (exclude: string[]) => string | undefined
}


export async function fetchOrderFileWith(pdfId: string, deps: OrderFileDeps): Promise<Uint8Array> {
  const tried: string[] = []
  let last = 'public.sud.uz file: captcha tokenini olib boʻlmadi'
  for (let attempt = 0; attempt < 2; attempt++) {
    const worker = deps.pick(tried)
    if (worker) tried.push(worker)
    let token: string
    try {
      token = await deps.getToken(worker)
    } catch (e) {
      last = `public.sud.uz file: captcha tokeni olinmadi (${e instanceof Error ? e.message.slice(0, 120) : 'xato'}). Sozlamalar › Captcha da VLM kalitini tekshiring`
      continue
    }
    const { status, body } = await deps.download(pdfId, token, worker)
    if (status >= 200 && status < 300) return body
    const text = Buffer.from(body.subarray(0, 300)).toString('utf8')
    if (isCaptchaRefusal(status, text)) {
      last = 'public.sud.uz file: captcha tokeni qabul qilinmadi'
      continue
    }
    throw new Error(`public.sud.uz file: HTTP ${status}`)
  }
  throw new Error(last)
}

