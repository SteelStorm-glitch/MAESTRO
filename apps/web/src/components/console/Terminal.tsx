import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RotateCw } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { connectTerminal, type TerminalConnection } from '../../api/terminal'

export function TerminalPanel() {
  const projectId = useAppStore((state) => state.projectId)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectionRef = useRef<TerminalConnection | null>(null)
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')

  useEffect(() => {
    if (!projectId || !hostRef.current) return
    const term = new XTerm({
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#0A0A0B',
        foreground: '#F4F4F5',
        cursor: '#8B8BF5',
        selectionBackground: '#2b2b45',
        black: '#0A0A0B',
        red: '#E5484D',
        green: '#46A758',
        yellow: '#FFB224',
        blue: '#5AC8FA',
        magenta: '#8B8BF5',
        cyan: '#2DD4BF',
        white: '#F4F4F5',
        brightBlack: '#5C5C66',
        brightWhite: '#FFFFFF',
      },
      scrollback: 5000,
      convertEol: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    term.focus()

    const connection = connectTerminal(projectId, {
      onData: (data) => term.write(data),
      onExit: (code) => term.write(`\r\n\x1b[38;5;245m[процесс завершён, код ${code}]\x1b[0m\r\n`),
      onStatus: setStatus,
    })
    connectionRef.current = connection

    const inputSub = term.onData((data) => connection.send({ type: 'input', data }))
    const resizeSub = term.onResize(({ cols, rows }) => connection.send({ type: 'resize', cols, rows }))

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* hidden */
      }
    })
    observer.observe(hostRef.current)

    return () => {
      observer.disconnect()
      inputSub.dispose()
      resizeSub.dispose()
      connection.close()
      term.dispose()
      termRef.current = null
      connectionRef.current = null
    }
  }, [projectId])

  if (!projectId) {
    return <div className="flex h-full items-center justify-center text-[12px] text-faint">Выберите проект</div>
  }

  return (
    <div className="relative h-full w-full bg-base">
      <div ref={hostRef} className="h-full w-full" />
      <div className="pointer-events-none absolute right-2 top-1 flex items-center gap-2 text-[10px] text-faint">
        <span className={status === 'open' ? 'text-ok' : status === 'connecting' ? 'text-warn' : 'text-danger'}>
          {status === 'open' ? 'PTY подключён' : status === 'connecting' ? 'подключение…' : 'отключён'}
        </span>
        <button
          className="icon-btn pointer-events-auto h-5 w-5"
          title="Перезапустить терминал"
          onClick={() => {
            connectionRef.current?.send({ type: 'restart' })
            termRef.current?.reset()
          }}
        >
          <RotateCw size={11} />
        </button>
      </div>
    </div>
  )
}
