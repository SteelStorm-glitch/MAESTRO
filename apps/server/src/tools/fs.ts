import fs from 'node:fs'
import path from 'node:path'
import type { TreeNode } from '@maestro/shared'
import { bus } from '../events/bus'
import { GuardError, DEFAULT_IGNORES, isProbablyText, projectRelative, readChunk, resolveProjectPath } from './guard'

export interface ToolContext {
  sessionId: string
  projectRoot: string
  roleId: string | null
  roleName: string
  signal?: AbortSignal
}

interface FsEventBase {
  path: string
  role_id: string | null
  role_name: string
  session_id: string
}

function emitFs(ctx: ToolContext, type: 'fs.create' | 'fs.write' | 'fs.delete' | 'fs.move', relPath: string, oldPath?: string) {
  const payload: FsEventBase & { old_path?: string } = {
    path: relPath,
    role_id: ctx.roleId,
    role_name: ctx.roleName,
    session_id: ctx.sessionId,
  }
  if (oldPath) payload.old_path = oldPath
  bus.emit(ctx.sessionId, type, payload)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fsList(ctx: ToolContext, args: { path?: string; depth?: number; show_hidden?: boolean }): string {
  const root = resolveProjectPath(ctx.projectRoot, args.path)
  const depth = Math.max(0, Math.min(args.depth ?? 2, 5))
  const lines: string[] = []
  let count = 0
  const maxEntries = 1500

  const walk = (absolute: string, level: number) => {
    if (count >= maxEntries) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of entries) {
      if (count >= maxEntries) break
      if (!args.show_hidden && entry.name.startsWith('.')) continue
      if (DEFAULT_IGNORES.has(entry.name)) {
        if (level === 0) lines.push(`${'  '.repeat(level)}${entry.name}/ (скрыто)`)
        continue
      }
      const child = path.join(absolute, entry.name)
      count++
      if (entry.isDirectory()) {
        lines.push(`${'  '.repeat(level)}${entry.name}/`)
        if (level < depth) walk(child, level + 1)
      } else {
        let size = 0
        try {
          size = fs.statSync(child).size
        } catch {
          size = 0
        }
        lines.push(`${'  '.repeat(level)}${entry.name}${level === depth ? '' : `  ${formatSize(size)}`}`)
      }
    }
  }

  walk(root, 0)
  const rel = projectRelative(ctx.projectRoot, root)
  const header = `Каталог: ${rel === '.' ? '.' : rel}/ (глубина ${depth})`
  return `${header}\n${lines.join('\n')}${count >= maxEntries ? `\n… показаны первые ${maxEntries} записей` : ''}`
}

export function fsRead(ctx: ToolContext, args: { path: string; offset?: number; limit?: number }): string {
  const absolute = resolveProjectPath(ctx.projectRoot, args.path)
  const limit = Math.max(1, Math.min(args.limit ?? 64 * 1024, 256 * 1024))
  const result = readChunk(absolute, args.offset ?? 0, limit)
  if (result.binary) {
    return JSON.stringify({
      path: projectRelative(ctx.projectRoot, absolute),
      binary: true,
      total_size: result.total_size,
      message: 'Бинарный файл — чтение текстом невозможно.',
    })
  }
  return JSON.stringify({
    path: projectRelative(ctx.projectRoot, absolute),
    content: result.content,
    size: result.total_size,
    offset: result.offset,
    next_offset: result.next_offset,
    truncated: result.truncated,
  })
}

export function fsWrite(
  ctx: ToolContext,
  args: { path: string; content: string; create_dirs?: boolean },
): string {
  const absolute = resolveProjectPath(ctx.projectRoot, args.path)
  const existed = fs.existsSync(absolute)
  if (existed && fs.statSync(absolute).isDirectory()) throw new GuardError('is_directory', 'Путь указывает на каталог')
  if (args.create_dirs !== false) fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, args.content ?? '', 'utf8')
  const rel = projectRelative(ctx.projectRoot, absolute)
  emitFs(ctx, existed ? 'fs.write' : 'fs.create', rel)
  return JSON.stringify({ ok: true, path: rel, bytes: Buffer.byteLength(args.content ?? '', 'utf8'), created: !existed })
}

export function fsAppend(ctx: ToolContext, args: { path: string; content: string }): string {
  const absolute = resolveProjectPath(ctx.projectRoot, args.path)
  const existed = fs.existsSync(absolute)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.appendFileSync(absolute, args.content ?? '', 'utf8')
  const rel = projectRelative(ctx.projectRoot, absolute)
  emitFs(ctx, existed ? 'fs.write' : 'fs.create', rel)
  return JSON.stringify({ ok: true, path: rel, created: !existed })
}

export function fsMove(ctx: ToolContext, args: { from: string; to: string; overwrite?: boolean }): string {
  const source = resolveProjectPath(ctx.projectRoot, args.from)
  const target = resolveProjectPath(ctx.projectRoot, args.to)
  if (!fs.existsSync(source)) throw new GuardError('not_found', `Не найден: ${args.from}`)
  if (fs.existsSync(target) && !args.overwrite) {
    throw new GuardError('exists', `Цель уже существует: ${args.to} (передайте overwrite=true)`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(source, target)
  const relFrom = projectRelative(ctx.projectRoot, source)
  const relTo = projectRelative(ctx.projectRoot, target)
  emitFs(ctx, 'fs.move', relTo, relFrom)
  return JSON.stringify({ ok: true, from: relFrom, to: relTo })
}

export function fsDelete(ctx: ToolContext, args: { path: string }): string {
  const absolute = resolveProjectPath(ctx.projectRoot, args.path)
  if (projectRelative(ctx.projectRoot, absolute) === '.') throw new GuardError('forbidden', 'Нельзя удалить корень проекта')
  // lstat does not follow symlinks, so broken links can still be removed.
  try {
    fs.lstatSync(absolute)
  } catch {
    throw new GuardError('not_found', `Не найден: ${args.path}`)
  }
  const trashDir = path.join(ctx.projectRoot, '.maestro_trash')
  fs.mkdirSync(trashDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let target = path.join(trashDir, `${stamp}_${path.basename(absolute)}`)
  let counter = 1
  while (fs.existsSync(target)) target = path.join(trashDir, `${stamp}_${counter++}_${path.basename(absolute)}`)
  fs.renameSync(absolute, target)
  const rel = projectRelative(ctx.projectRoot, absolute)
  emitFs(ctx, 'fs.delete', rel)
  return JSON.stringify({
    ok: true,
    path: rel,
    trashed_to: projectRelative(ctx.projectRoot, target),
    message: 'Файл перемещён в .maestro_trash (восстановим при необходимости).',
  })
}

/** Minimal .gitignore matcher: supports *, **, ?, directory patterns and leading slashes. */
function gitignoreMatcher(root: string): ((relative: string, isDir: boolean) => boolean) | null {
  const file = path.join(root, '.gitignore')
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const patterns: Array<{ re: RegExp; dirOnly: boolean }> = []
  for (const line of raw.split(/\r?\n/)) {
    let pattern = line.trim()
    if (!pattern || pattern.startsWith('#') || pattern.startsWith('!')) continue
    let dirOnly = false
    if (pattern.endsWith('/')) {
      dirOnly = true
      pattern = pattern.slice(0, -1)
    }
    // A leading slash anchors the pattern to the repository root; check before stripping it.
    const anchored = pattern.startsWith('/') || pattern.includes('/')
    pattern = pattern.replace(/^\/+/, '')
    if (!pattern) continue
    const escaped = pattern
      .split('')
      .map((char) => (char === '*' || char === '?' ? char : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
      .join('')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
    try {
      patterns.push({
        re: new RegExp(anchored ? `^${escaped}(?:$|/)` : `(?:^|/)${escaped}(?:$|/)`),
        dirOnly,
      })
    } catch {
      /* skip malformed pattern */
    }
  }
  if (patterns.length === 0) return null
  return (relative, isDir) => {
    const target = relative.split(path.sep).join('/')
    return patterns.some(({ re, dirOnly }) => (dirOnly && !isDir ? false : re.test(target)))
  }
}

export function buildTree(rootPath: string, maxDepth = 3, showHidden = false, hideGitignored = false): TreeNode[] {
  const root = path.resolve(rootPath)
  let count = 0
  const maxNodes = 5000
  const isIgnored = hideGitignored ? gitignoreMatcher(root) : null

  const walk = (dir: string, level: number): TreeNode[] => {
    if (level > maxDepth || count >= maxNodes) return []
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const nodes: TreeNode[] = []
    for (const entry of entries) {
      if (count >= maxNodes) break
      const hidden = entry.name.startsWith('.')
      if (!showHidden && hidden) continue
      if (DEFAULT_IGNORES.has(entry.name) && entry.isDirectory()) continue
      const absolute = path.join(dir, entry.name)
      const rel = projectRelative(root, absolute)
      if (isIgnored?.(rel, entry.isDirectory())) continue
      count++
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'dir',
          hidden,
          children: level < maxDepth ? walk(absolute, level + 1) : undefined,
        })
      } else {
        let size = 0
        try {
          size = fs.statSync(absolute).size
        } catch {
          size = 0
        }
        nodes.push({ name: entry.name, path: rel, type: 'file', size, hidden })
      }
    }
    return nodes
  }

  return walk(root, 0)
}

export function previewFile(rootPath: string, relative: string, maxBytes = 512 * 1024) {
  const absolute = resolveProjectPath(rootPath, relative)
  const stat = fs.statSync(absolute)
  if (stat.isDirectory()) throw new GuardError('is_directory', 'Это каталог')
  const binary = !isProbablyText(relative)
  const result = readChunk(absolute, 0, Math.min(maxBytes, 512 * 1024))
  return {
    path: projectRelative(rootPath, absolute),
    size: stat.size,
    binary: binary || result.binary,
    truncated: result.truncated,
    content: binary || result.binary ? '' : result.content,
  }
}
