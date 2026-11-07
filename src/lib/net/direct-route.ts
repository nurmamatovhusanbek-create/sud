/**
 * A «route» for a captcha session is either a Cloudflare worker URL or «direct:<origin>»: this machine calls the site
 * itself, sending that Origin/Referer (what a browser on that site sends). Pure, shared by billing and the order file.
 */
const PREFIX = 'direct:'

export const directRoute = (origin: string): string => PREFIX + origin

/** the origin of a direct route, or null for a worker URL / nothing */
export const directOriginOf = (route?: string): string | null => (route && route.startsWith(PREFIX) ? route.slice(PREFIX.length) : null)
