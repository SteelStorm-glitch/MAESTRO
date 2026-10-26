import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import type { WebSocket } from 'ws'
import { bus } from '../events/bus'
import { getProject } from '../db/repo/projects'
import { getSession } from '../db/repo/sessions'
import { logger } from '../lib/logger'
import { shellBinary } from '../tools/guard'

interface PtyLike {
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  pid: number
}

interface ProjectTerminal {
  projectId: string
  root: string
  pty: PtyLike | null
  subscribers: Set<WebSocket>
  buffer: string
  lastActivity: number
  agentListener: () => void
  /** Incremented on restart so listeners of the old PTY can be ignored. */
  generation: number
}

function safeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/api[_-]?key|secret|token|password|credential/i.test(key)) continue
    env[key] = value
  }
  env.MAESTRO_AGENT = '1'
  env.FORCE_COLOR = '1'
  return env
}

async function createPty(root: string): Promise<PtyLike> {
  try {
    const ptyModule = await import('node-pty')
    const pty = ptyModule.spawn(shellBinary(), process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: root,
      env: safeEnv() as Record<string, string>,
    })
    return pty as unknown as PtyLike
  } catch (error) {
    logger.warn('node-pty unavailable, falling back to plain pipes', { error: String(error) })
    return createPipeShell(root)
  }
}

/** Pick flags that match the actual shell binary (ComSpec may point at PowerShell). */
function pipeShellArgs(binary: string): string[] {
  if (process.platform !== 'win32') return ['-i']
  const base = path.basename(binary).toLowerCase()
  if (base.includes('powershell') || base === 'pwsh' || base === 'pwsh.exe') return ['-NoLogo']
  if (base === 'cmd.exe' || base === 'cmd') return ['/Q']
  return []
}

function createPipeShell(root: string): PtyLike {
  const isWin = process.platform === 'win32'
  const binary = shellBinary()
  const child: ChildProcessWithoutNullStreams = isWin
    ? spawn(binary, pipeShellArgs(binary), { cwd: root, env: safeEnv(), windowsHide: true })
    : spawn(binary, pipeShellArgs(binary), { cwd: root, env: safeEnv() })
  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(event: { exitCode: number }) => void> = []
  child.stdout.on('data', (chunk: Buffer) => dataListeners.forEach((fn) => fn(chunk.toString('utf8'))))
  child.stderr.on('data', (chunk: Buffer) => dataListeners.forEach((fn) => fn(chunk.toString('utf8'))))
  child.on('exit', (code) => exitListeners.forEach((fn) => fn({ exitCode: code ?? 0 })))
  return {
    pid: child.pid ?? 0,
    onData: (fn) => dataListeners.push(fn),
    onExit: (fn) => exitListeners.push(fn),
    write: (data) => child.stdin.write(data),
    resize: () => undefined,
    kill: () => child.kill(),
  }
}

class TerminalManager {
  private terminals = new Map<string, ProjectTerminal>()
  private subscribed = false

  constructor() {
    this.subscribeAgentShell()
  }

  private subscribeAgentShell(): void {
    if (this.subscribed) return
    this.subscribed = true
    bus.subscribe((envelope) => {
      if (envelope.channel !== 'event') return
      const event = envelope.event
      if (event.type !== 'shell.exec') return
      const payload = event.payload as {
        command?: string
        output?: string
        code?: number | null
        role_name?: string
      }
      if (!event.session_id) return
      const session = getSession(event.session_id)
      if (!session) return
      const terminal = this.terminals.get(session.project_id)
      if (!terminal) return
      const prefix = payload.role_name ? `[agent:${payload.role_name}]` : '[agent]'
      const line = `\r\n\x1b[38;5;141m${prefix} $ ${payload.command ?? ''}\x1b[0m\r\n${payload.output ?? ''}\r\n$ `
      this.broadcast(terminal, { type: 'output', data: line })
    })
  }

  async attach(projectId: string, ws: WebSocket): Promise<void> {
    const project = getProject(projectId)
    if (!project) {
      ws.send(JSON.stringify({ type: 'error', message: 'Проект не найден' }))
      ws.close()
      return
    }
    let terminal = this.terminals.get(projectId)
    if (!terminal) {
      terminal = {
        projectId,
        root: project.root_path,
        pty: null,
        subscribers: new Set(),
        buffer: '',
        lastActivity: Date.now(),
        agentListener: () => undefined,
        generation: 0,
      }
      this.terminals.set(projectId, terminal)
      await this.spawnPty(terminal)
      logger.info(`PTY started for ${project.root_path} (pid ${terminal.pty?.pid ?? '?'})`)
    } else if (!terminal.pty) {
      await this.spawnPty(terminal)
    }

    terminal.subscribers.add(ws)
    if (terminal.buffer) ws.send(JSON.stringify({ type: 'output', data: terminal.buffer }))

    ws.on('message', (raw) => {
      const text = raw.toString()
      try {
        const parsed = JSON.parse(text) as { type?: string; cols?: number; rows?: number; data?: string }
        if (parsed.type === 'restart') {
          const current = this.terminals.get(projectId)
          if (current && current !== terminal) return
          this.terminals.set(projectId, terminal)
          void this.spawnPty(terminal)
            .then(() => {
              this.broadcast(terminal, { type: 'output', data: '\r\n\x1b[38;5;245m[терминал перезапущен]\x1b[0m\r\n' })
            })
            .catch((error: unknown) => {
              this.broadcast(terminal, { type: 'error', message: `Не удалось перезапустить терминал: ${String(error)}` })
            })
          return
        }
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          terminal?.pty?.resize(parsed.cols, parsed.rows)
          return
        }
        if (parsed.type === 'input' && typeof parsed.data === 'string') {
          terminal?.pty?.write(parsed.data)
          return
        }
      } catch {
        terminal?.pty?.write(text)
      }
    })

    ws.on('close', () => {
      terminal?.subscribers.delete(ws)
      if (terminal && terminal.subscribers.size === 0 && !terminal.pty) {
        if (this.terminals.get(projectId) === terminal) this.terminals.delete(projectId)
      }
    })
  }

  /** Start (or restart) the PTY for a project terminal and wire its listeners. */
  private async spawnPty(terminal: ProjectTerminal): Promise<void> {
    terminal.generation++
    const generation = terminal.generation
    if (terminal.pty) {
      try {
        terminal.pty.kill()
      } catch {
        /* already dead */
      }
    }
    const pty = await createPty(terminal.root)
    terminal.pty = pty
    terminal.buffer = ''
    terminal.lastActivity = Date.now()
    pty.onData((data) => {
      if (terminal.generation !== generation) return
      terminal.buffer = (terminal.buffer + data).slice(-120_000)
      terminal.lastActivity = Date.now()
      this.broadcast(terminal, { type: 'output', data })
    })
    pty.onExit(({ exitCode }) => {
      if (terminal.generation !== generation) return
      if (terminal.pty === pty) terminal.pty = null
      this.broadcast(terminal, { type: 'exit', code: exitCode })
      if (terminal.subscribers.size === 0 && this.terminals.get(terminal.projectId) === terminal) {
        this.terminals.delete(terminal.projectId)
      }
    })
  }

  /** Stop and forget the terminal of a deleted project. */
  close(projectId: string): void {
    const terminal = this.terminals.get(projectId)
    if (!terminal) return
    this.terminals.delete(projectId)
    terminal.generation++
    try {
      terminal.pty?.kill()
    } catch {
      /* already dead */
    }
    terminal.pty = null
    terminal.subscribers.clear()
  }

  private broadcast(terminal: ProjectTerminal, message: unknown): void {
    const raw = JSON.stringify(message)
    for (const ws of terminal.subscribers) {
      if (ws.readyState === 1) ws.send(raw)
    }
  }

  closeAll(): void {
    for (const terminal of this.terminals.values()) {
      terminal.generation++
      try {
        terminal.pty?.kill()
      } catch {
        /* ignore */
      }
      terminal.pty = null
    }
    this.terminals.clear()
  }
}

export const terminals = new TerminalManager()
