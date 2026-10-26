import fs from 'node:fs'
import { LOG_PATH, MAESTRO_HOME } from './paths'

type Level = 'debug' | 'info' | 'warn' | 'error'

const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{6,})/g,
  /\b(xai-[A-Za-z0-9_-]{6,})/g,
  /\b(AIza[0-9A-Za-z_-]{10,})/g,
  /\b(gsk_[A-Za-z0-9_-]{6,})/g,
]

export function maskSecrets(input: string): string {
  let out = input
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => `${m.slice(0, 3)}••••${m.slice(-4)}`)
  return out
}

let stream: fs.WriteStream | null = null
function fileStream(): fs.WriteStream | null {
  if (stream) return stream
  try {
    fs.mkdirSync(MAESTRO_HOME, { recursive: true })
    stream = fs.createWriteStream(LOG_PATH, { flags: 'a' })
    return stream
  } catch {
    return null
  }
}

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  const time = new Date().toISOString()
  const safe = maskSecrets(typeof message === 'string' ? message : String(message))
  const suffix = extra === undefined ? '' : ` ${safeStringify(extra)}`
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${safe}${suffix}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  fileStream()?.write(line + '\n')
}

function safeStringify(value: unknown): string {
  try {
    return maskSecrets(JSON.stringify(value))
  } catch {
    return '[unserialisable]'
  }
}

export interface Logger {
  debug(message: string, extra?: unknown): void
  info(message: string, extra?: unknown): void
  warn(message: string, extra?: unknown): void
  error(message: string, extra?: unknown): void
  child(scope: string): Logger
}

export function createLogger(scope = 'app'): Logger {
  const prefix = scope
  return {
    debug: (m, e) => emit('debug', prefix, m, e),
    info: (m, e) => emit('info', prefix, m, e),
    warn: (m, e) => emit('warn', prefix, m, e),
    error: (m, e) => emit('error', prefix, m, e),
    child: (child) => createLogger(`${prefix}:${child}`),
  }
}

export const logger = createLogger('maestro')
