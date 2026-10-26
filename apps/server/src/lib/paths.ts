import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MAESTRO_HOME = process.env.MAESTRO_HOME
  ? path.resolve(process.env.MAESTRO_HOME)
  : path.join(os.homedir(), '.maestro')

export const DB_PATH = process.env.MAESTRO_DB ? path.resolve(process.env.MAESTRO_DB) : path.join(MAESTRO_HOME, 'maestro.db')
export const SECRET_PATH = path.join(MAESTRO_HOME, 'secret')
export const LOG_PATH = path.join(MAESTRO_HOME, 'maestro.log')

export function ensureHome(): void {
  fs.mkdirSync(MAESTRO_HOME, { recursive: true })
}

/** Resolve and verify that `candidate` stays inside `root` (after symlink resolution). */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function safeJoin(root: string, relative: string): string {
  const normalisedRoot = path.resolve(root)
  const resolved = path.resolve(normalisedRoot, relative)
  if (!isInside(normalisedRoot, resolved)) {
    const err = new Error(`Path escapes project root: ${relative}`)
    ;(err as NodeJS.ErrnoException).code = 'PATH_ESCAPE'
    throw err
  }
  return resolved
}

/** realpath that tolerates non-existent leaf paths (walks up to the nearest existing parent). */
export function realpathLoose(target: string): string {
  let current = path.resolve(target)
  const tail: string[] = []
  for (;;) {
    try {
      const real = fs.realpathSync.native(current)
      return path.join(real, ...tail.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(target)
      tail.push(path.basename(current))
      current = parent
    }
  }
}
