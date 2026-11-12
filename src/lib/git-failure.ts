/**
 * Why a `git` call failed, in words the operator can act on. Pure (no child_process), so it is tested.
 *
 * The update button used to say «Git topilmadi» for EVERY failure of `git rev-parse`: git missing from PATH, git
 * refusing a folder it thinks belongs to someone else («dubious ownership», common on Windows), or a slow disk making
 * the call time out. Three different fixes, one useless message.
 */

export type GitFailureKind = 'missing' | 'dubious_ownership' | 'timeout' | 'not_repo' | 'other'

export interface GitFailure {
  kind: GitFailureKind
  /** one actionable sentence (Uzbek) */
  detail: string
}

interface ExecErrorLike {
  code?: string | number
  signal?: string | null
  killed?: boolean
  stderr?: unknown
  message?: unknown
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : '')

/** git prints the exact command to fix «dubious ownership»; use it, else build it from the folder. */
function safeDirectoryCommand(stderr: string, cwd?: string): string {
  const m = /git config --global --add safe\.directory\s+(.+)/.exec(stderr)
  if (m) return `git config --global --add safe.directory ${m[1].trim()}`
  const dir = (cwd ?? '').replace(/\\/g, '/')
  return `git config --global --add safe.directory "${dir || '<loyiha papkasi>'}"`
}

export function classifyGitFailure(err: unknown, cwd?: string): GitFailure {
  const e = (err ?? {}) as ExecErrorLike
  const stderr = text(e.stderr)
  const all = `${stderr}\n${text(e.message)}`.toLowerCase()

  if (all.includes('dubious ownership')) {
    return { kind: 'dubious_ownership', detail: `Git bu papkani begona egasiniki deb hisoblab rad etdi. Terminalda bir marta bajaring: ${safeDirectoryCommand(stderr, cwd)}` }
  }
  if (e.code === 'ETIMEDOUT' || (e.killed === true && e.signal === 'SIGTERM') || all.includes('etimedout')) {
    return { kind: 'timeout', detail: 'Git juda sekin javob berdi (disk sekin yoki antivirus/OneDrive tekshiryapti). Loyihani C:\\dev kabi oddiy papkaga koʻchiring yoki qayta urinib koʻring.' }
  }
  if (e.code === 'ENOENT' || all.includes('is not recognized') || all.includes('command not found') || (all.includes('not found') && all.includes('git'))) {
    return { kind: 'missing', detail: 'Git oʻrnatilmagan yoki PATH da yoʻq. git-scm.com dan oʻrnating va serverni yangi terminalda qayta ishga tushiring.' }
  }
  if (all.includes('not a git repository')) {
    return { kind: 'not_repo', detail: 'Bu papka git repozitoriysi emas (.git yoʻq). Loyiha git clone orqali olinmagan boʻlsa, avtomatik yangilash ishlamaydi.' }
  }
  const first = stderr.trim().split('\n')[0] || text(e.message).split('\n')[0] || 'sabab nomaʼlum'
  return { kind: 'other', detail: `Git xato berdi: ${first.slice(0, 200)}` }
}
