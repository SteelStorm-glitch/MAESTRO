import fs from 'node:fs'
import path from 'node:path'
import { isInside, realpathLoose, safeJoin } from '../lib/paths'

export class GuardError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GuardError'
    this.code = code
  }
}

/**
 * Resolve a project-relative path and make sure both the raw path and its
 * realpath stay inside the project root. Symlinks pointing outside are rejected.
 */
export function resolveProjectPath(rootPath: string, relative: string | undefined): string {
  const root = realpathLoose(rootPath)
  const requested = (relative ?? '.').replace(/^[/\\]+/, '')
  let candidate: string
  try {
    candidate = safeJoin(root, requested)
  } catch {
    throw new GuardError('path_escape', `Путь вне проекта: ${relative}`)
  }
  const real = realpathLoose(candidate)
  if (!isInside(root, real)) {
    throw new GuardError('path_escape', `Путь выводит за пределы проекта (симлинк): ${relative}`)
  }
  return candidate
}

export function projectRelative(rootPath: string, absolute: string): string {
  const rel = path.relative(realpathLoose(rootPath), absolute).split(path.sep).join('/')
  return rel || '.'
}

const TEXT_SNIFF_BYTES = 8192

export function looksBinary(buffer: Buffer): boolean {
  const slice = buffer.subarray(0, Math.min(buffer.length, TEXT_SNIFF_BYTES))
  for (let i = 0; i < slice.length; i++) {
    const byte = slice[i]!
    if (byte === 0) return true
  }
  return false
}

export function readChunk(absolute: string, offset: number, limit: number) {
  const stat = fs.statSync(absolute)
  if (stat.isDirectory()) throw new GuardError('is_directory', 'Это каталог, а не файл')
  if (stat.size > 64 * 1024 * 1024) throw new GuardError('file_too_large', `Файл слишком большой: ${stat.size} байт`)
  const handle = fs.openSync(absolute, 'r')
  try {
    const effectiveOffset = Math.max(0, Math.min(offset, stat.size))
    const length = Math.max(0, Math.min(limit, stat.size - effectiveOffset))
    const buffer = Buffer.alloc(length)
    fs.readSync(handle, buffer, 0, length, effectiveOffset)
    const binary = looksBinary(buffer)
    return {
      content: binary ? '' : buffer.toString('utf8'),
      binary,
      offset: effectiveOffset,
      next_offset: effectiveOffset + length,
      total_size: stat.size,
      truncated: effectiveOffset + length < stat.size,
    }
  } finally {
    fs.closeSync(handle)
  }
}

export const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  '.maestro_trash',
  'dist',
  'build',
  '.next',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.cache',
])

export function isProbablyText(file: string): boolean {
  const binaryExt = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|woff2?|ttf|otf|mp3|mp4|mov|avi|sqlite3?|db|pyc|class|jar)$/i
  return !binaryExt.test(file)
}

export function shellBinary(): string {
  if (process.platform === 'win32') return process.env.ComSpec ?? 'cmd.exe'
  return process.env.SHELL ?? '/bin/sh'
}

const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+[\\/]?(\*|~|\/|\.\.|c:\\)/i,
  /\brm\s+-rf\s+[\\/]/i,
  /\bsudo\b/i,
  /\bdoas\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdd\s+if=.*of=\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /\binit\s+0\b/i,
  /\b(chmod|chown)\s+-R\s+[0-7]+\s+[\\/]\s*$/i,
  /\breg\s+delete\b/i,
  /\bdel\s+\/[fsq]\b.*[a-z]:\\/i,
  /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\/i,
  /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, // fork bomb
  /\b(curl|wget)\b[^|;&]*\|\s*(ba|z|da)?sh\b/i,
  /\bgit\s+push\b[^|;&]*(\s--force\b|\s-f\b)/i,
  />\s*\/dev\/(sd|hd|nvme)/i,
  /\bdiskpart\b/i,
  /\bcipher\s+\/w\b/i,
  /\bremove-item\b[^|;&]*(-recurse|-force)/i,
  /\bclear-content\b/i,
  /\bdel\b[^|;&\n]*\/[fsq]\b[^|;&\n]*(\*|[a-z]:[\\/])/i,
  /\b(rd|rmdir)\s+\/s\b[^|;&]*(\*|\.[\\/]?)(\s|$)/i,
]

export function assertCommandSafe(command: string): void {
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(command)) {
      throw new GuardError('shell_denied', `Команда заблокирована политикой безопасности: ${command}`)
    }
  }
  if (command.length > 4000) throw new GuardError('shell_denied', 'Слишком длинная команда')
}
