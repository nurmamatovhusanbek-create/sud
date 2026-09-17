/**
 * Structured, levelled logger — P2 of the rebuild blueprint (§3.8).
 *
 * Replaces ~140 scattered console.* calls in NEW code. The scraper libs keep
 * their console output until their adapters migrate them (parity rule).
 *
 * Dev: human-readable single line. Prod: one JSON object per line (queryable).
 */

import { config } from '@/server/config'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function currentMin(): number {
  return LEVEL_WEIGHT[(config.logLevel as Level) in LEVEL_WEIGHT ? (config.logLevel as Level) : 'info']
}

function emit(level: Level, scope: string, msg: string, fields?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < currentMin()) return
  const ts = new Date().toISOString()
  if (config.env === 'production') {
    const line = JSON.stringify({ ts, level, scope, msg, ...fields })
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  } else {
    const extra = fields && Object.keys(fields).length ? ' ' + JSON.stringify(fields) : ''
    const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${extra}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  child(scope: string): Logger
}

export function logger(scope: string): Logger {
  return {
    debug: (msg, fields) => emit('debug', scope, msg, fields),
    info: (msg, fields) => emit('info', scope, msg, fields),
    warn: (msg, fields) => emit('warn', scope, msg, fields),
    error: (msg, fields) => emit('error', scope, msg, fields),
    child: (sub) => logger(`${scope}:${sub}`),
  }
}
