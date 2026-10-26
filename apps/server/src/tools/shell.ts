import { spawn } from 'node:child_process'
import path from 'node:path'
import { bus } from '../events/bus'
import { truncateMiddle } from '../lib/tokens'
import type { ToolContext } from './fs'
import { resolveProjectPath, shellBinary } from './guard'

const MAX_OUTPUT = 100_000

function safeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/api[_-]?key|secret|token|password|passwd|credential/i.test(key)) continue
    env[key] = value
  }
  env.MAESTRO_AGENT = '1'
  return env
}

export interface ShellResult {
  code: number | null
  output: string
  timedOut: boolean
  cwd: string
}

export function runShell(
  ctx: ToolContext,
  command: string,
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<ShellResult> {
  const cwd = options.cwd ? resolveProjectPath(ctx.projectRoot, options.cwd) : ctx.projectRoot
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 120000, 600000))
  const started = Date.now()

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = isWin
      ? spawn(shellBinary(), ['/d', '/s', '/c', command], { cwd, env: safeEnv(), windowsHide: true })
      : spawn(shellBinary(), ['-c', command], { cwd, env: safeEnv() })

    let output = ''
    let timedOut = false
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT * 2) output += chunk.toString('utf8')
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const timer = setTimeout(() => {
      timedOut = true
      if (isWin && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          child.kill()
        }
      } else {
        child.kill('SIGKILL')
      }
    }, timeoutMs)

    const onAbort = () => {
      timedOut = false
      if (isWin && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          child.kill()
        }
      } else {
        child.kill('SIGKILL')
      }
    }
    ctx.signal?.addEventListener('abort', onAbort, { once: true })

    let finished = false
    const finish = (code: number | null) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      ctx.signal?.removeEventListener('abort', onAbort)
      const truncated = truncateMiddle(output, MAX_OUTPUT)
      const ok = code === 0 && !timedOut
      bus.emit(ctx.sessionId, 'shell.exec', {
        command,
        cwd,
        code,
        ok,
        output: truncateMiddle(output, 4096),
        duration_ms: Date.now() - started,
        role_id: ctx.roleId,
        role_name: ctx.roleName,
        session_id: ctx.sessionId,
      })
      resolve({
        code,
        output: timedOut ? `${truncated}\n[превышен таймаут ${timeoutMs} мс]` : truncated,
        timedOut,
        cwd: path.relative(ctx.projectRoot, cwd) || '.',
      })
    }

    child.on('error', (error) => {
      output += `\n[ошибка запуска: ${error.message}]`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}
