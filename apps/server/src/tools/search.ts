import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DEFAULT_IGNORES, isProbablyText, projectRelative, resolveProjectPath } from './guard'
import type { ToolContext } from './fs'

export interface SearchArgs {
  pattern: string
  glob?: string
  path?: string
  max_results?: number
  ignore_case?: boolean
}

export async function fsSearch(ctx: ToolContext, args: SearchArgs): Promise<string> {
  const maxResults = Math.max(1, Math.min(args.max_results ?? 100, 500))
  const target = resolveProjectPath(ctx.projectRoot, args.path)
  const rgResult = await tryRipgrep(ctx, args, target, maxResults)
  if (rgResult !== null) return rgResult
  return fallbackSearch(ctx, args, target, maxResults)
}

function tryRipgrep(
  ctx: ToolContext,
  args: SearchArgs,
  target: string,
  maxResults: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const cli = ['--json', '--max-filesize', '2M', '--max-columns', '400']
    if (args.ignore_case) cli.push('--ignore-case')
    if (args.glob) cli.push('--glob', args.glob)
    cli.push('--', args.pattern, target)
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.platform === 'win32' ? 'rg.exe' : 'rg', cli, {
        cwd: ctx.projectRoot,
        windowsHide: true,
      })
    } catch {
      resolve(null)
      return
    }
    let output = ''
    let settled = false
    let stderr = ''
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (output.length < 200_000) output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        const matches: Array<{ path: string; lineNumber: number; text: string }> = []
        for (const record of output.split(/\r?\n/).filter(Boolean)) {
          try {
            const event = JSON.parse(record) as {
              type?: string
              data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } }
            }
            if (event.type !== 'match' || !event.data?.path?.text) continue
            matches.push({
              path: event.data.path.text,
              lineNumber: event.data.line_number ?? 0,
              text: (event.data.lines?.text ?? '').replace(/[\r\n]+$/, ''),
            })
          } catch {
            continue
          }
        }
        const limited = matches.slice(0, maxResults)
        const relative = limited.map((match) => {
          const filePath = path.isAbsolute(match.path) ? projectRelative(ctx.projectRoot, match.path) : match.path
          return `${filePath}:${match.lineNumber}:${match.text}`
        })
        finish(
          relative.length === 0
            ? `Совпадений не найдено: ${args.pattern}`
            : `${relative.join('\n')}${matches.length > maxResults ? `\n… ещё ${matches.length - maxResults} совпадений` : ''}`,
        )
        return
      }
      if (code === 2) {
        finish(null)
        return
      }
      void stderr
      finish(null)
    })
    ctx.signal?.addEventListener('abort', () => child.kill(), { once: true })
  })
}

function fallbackSearch(ctx: ToolContext, args: SearchArgs, target: string, maxResults: number): string {
  let matcher: RegExp
  try {
    matcher = new RegExp(args.pattern, args.ignore_case ? 'i' : '')
  } catch {
    matcher = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.ignore_case ? 'i' : '')
  }
  const globRe = args.glob ? globToRegExp(args.glob) : null
  const results: string[] = []
  const root = path.resolve(ctx.projectRoot)
  let visited = 0

  const walk = (dir: string) => {
    if (results.length >= maxResults || visited > 4000 || ctx.signal?.aborted) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
      if (DEFAULT_IGNORES.has(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      const rel = projectRelative(root, absolute)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      visited++
      if (globRe && !globRe.test(rel)) continue
      if (!isProbablyText(entry.name)) continue
      let stat: fs.Stats
      try {
        stat = fs.statSync(absolute)
      } catch {
        continue
      }
      if (stat.size > 2 * 1024 * 1024) continue
      let content: string
      try {
        content = fs.readFileSync(absolute, 'utf8')
      } catch {
        continue
      }
      const lines = content.split(/\r?\n/)
      lines.forEach((line, index) => {
        if (results.length >= maxResults) return
        if (line.length > 400) return
        if (matcher.test(line)) results.push(`${rel}:${index + 1}: ${line.trim()}`)
      })
    }
  }

  walk(target)
  if (results.length === 0) return `Совпадений не найдено: ${args.pattern}`
  return `${results.join('\n')}${results.length >= maxResults ? `\n… показаны первые ${maxResults}` : ''}`
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`(^|/)${escaped}$`)
}
