/**
 * Whose is a scraping worker? A Cloudflare worker sees every request sent through it IN PLAINTEXT (company STIRs, case numbers,
 * bill lookups, captcha tokens) and can answer with anything, so a worker on someone else's account can read and forge the
 * operator's data. The operator names the accounts they control; a worker outside them is allowed (it is their call) but is
 * shown with a warning everywhere it appears. Pure: the account is read from the name (`<worker>.<account>.workers.dev`).
 */

/** The Cloudflare account of a `*.workers.dev` URL; null for a custom domain (the owner cannot be read from the name). */
export function workerAccount(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  const m = /^[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev$/.exec(host)
  return m ? m[1] : null
}

/** The accounts the operator trusts: those of the default pool (confirmed as theirs) plus `extra` (env `TRUSTED_WORKER_ACCOUNTS`). */
export function trustedAccounts(defaults: string[], extra: string[] = []): Set<string> {
  const out = new Set<string>()
  for (const u of defaults) {
    const a = workerAccount(u)
    if (a) out.add(a)
  }
  for (const e of extra) {
    const a = e.trim().toLowerCase()
    if (/^[a-z0-9-]+$/.test(a)) out.add(a)
  }
  return out
}

/** True only when the worker's account is a trusted one. A custom domain is NOT trusted by default (nothing proves whose it is). */
export function isTrustedWorker(url: string, trusted: Set<string>): boolean {
  const a = workerAccount(url)
  return a !== null && trusted.has(a)
}
