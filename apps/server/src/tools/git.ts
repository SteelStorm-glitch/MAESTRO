import { execFile } from 'node:child_process'
import type { ToolContext } from './fs'
import { projectRelative, resolveProjectPath } from './guard'

function git(args: string[], ctx: ToolContext, maxChars = 60_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: ctx.projectRoot, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal: ctx.signal },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          resolve(`git ${args.join(' ')} завершился с ошибкой: ${(stderr || error.message).slice(0, 4000)}`)
          return
        }
        const text = (stdout || stderr || '').trim()
        resolve(text.length > maxChars ? `${text.slice(0, maxChars)}\n… (обрезано)` : text || '(пусто)')
      },
    )
  })
}

export function gitStatus(ctx: ToolContext): Promise<string> {
  return git(['status', '--porcelain=v1', '--branch'], ctx)
}

export function gitDiff(ctx: ToolContext, args: { path?: string; staged?: boolean }): Promise<string> {
  const cli = ['diff', '--no-color']
  if (args.staged) cli.push('--cached')
  if (args.path) {
    const absolute = resolveProjectPath(ctx.projectRoot, args.path)
    cli.push('--', projectRelative(ctx.projectRoot, absolute))
  }
  return git(cli, ctx)
}

export function gitLog(ctx: ToolContext): Promise<string> {
  return git(['log', '--oneline', '-15', '--no-color'], ctx)
}
