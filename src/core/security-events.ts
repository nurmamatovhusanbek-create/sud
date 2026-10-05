/**
 * Security events as the server records them and the Settings › Xavfsizlik panel shows them. Pure types and the
 * Uzbek labels, so the client can import this file (server/audit.ts holds the ring itself).
 */

export type SecurityEventKind =
  | 'bad_host'
  | 'cross_site'
  | 'privileged_header'
  | 'unauthorized'
  | 'rate_limited'
  | 'too_large'
  /** a privileged route was called and let through (git pull + restart, worker list, Tor) */
  | 'privileged_call'

export interface SecurityEvent {
  ts: number
  kind: SecurityEventKind
  method: string
  /** pathname only */
  path: string
  /** short reason, e.g. `Sec-Fetch-Site: cross-site` (never a header value that could hold a secret) */
  detail?: string
}

export interface SecuritySnapshot {
  since: number
  counts: Record<SecurityEventKind, number>
  recent: SecurityEvent[]
}

export const SECURITY_EVENT_KINDS: SecurityEventKind[] = ['bad_host', 'cross_site', 'privileged_header', 'unauthorized', 'rate_limited', 'too_large', 'privileged_call']

/** What each kind means to the operator. `bad` = something was refused; `door` = a dangerous door was used on purpose. */
export const SECURITY_EVENT_LABEL: Record<SecurityEventKind, { text: string; hint: string; tone: 'bad' | 'door' }> = {
  bad_host: { text: 'Notoʻgʻri Host', hint: 'Boshqa nomdan (DNS rebinding) kelgan soʻrov', tone: 'bad' },
  cross_site: { text: 'Boshqa saytdan', hint: 'Brauzerda ochiq boshqa sahifa ilovaga soʻrov yubordi', tone: 'bad' },
  privileged_header: { text: 'Tasdiq sarlavhasiz', hint: 'Xavfli eshikka tasdiq sarlavhasisiz urinish', tone: 'bad' },
  unauthorized: { text: 'Token notoʻgʻri', hint: 'APP_API_TOKEN yoʻq yoki xato', tone: 'bad' },
  rate_limited: { text: 'Juda koʻp soʻrov', hint: 'Soʻrovlar chegarasi oshdi', tone: 'bad' },
  too_large: { text: 'Juda katta soʻrov', hint: 'Soʻrov hajmi chegaradan katta', tone: 'bad' },
  privileged_call: { text: 'Xavfli eshik ochildi', hint: 'Yangilash (git pull), worker roʻyxati yoki Tor ishga tushirildi', tone: 'door' },
}
