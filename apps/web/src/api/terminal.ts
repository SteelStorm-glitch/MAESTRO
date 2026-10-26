export interface TerminalConnection {
  send(data: unknown): void
  close(): void
}

export function connectTerminal(
  projectId: string,
  handlers: {
    onData: (data: string) => void
    onExit?: (code: number) => void
    onStatus?: (status: 'connecting' | 'open' | 'closed') => void
  },
): TerminalConnection {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const token = localStorage.getItem('maestro_token')
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : ''
  const url = `${protocol}://${location.host}/api/terminal?project=${encodeURIComponent(projectId)}${tokenParam}`
  let ws: WebSocket | null = null
  let closedByUser = false
  let attempts = 0

  const connect = () => {
    if (closedByUser) return
    handlers.onStatus?.('connecting')
    ws = new WebSocket(url)
    ws.onopen = () => {
      attempts = 0
      handlers.onStatus?.('open')
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type: string; data?: string; code?: number; message?: string }
        if (message.type === 'output' && message.data) handlers.onData(message.data)
        else if (message.type === 'exit') handlers.onExit?.(message.code ?? 0)
        else if (message.type === 'error' && message.message) handlers.onData(`\r\n[${message.message}]\r\n`)
      } catch {
        handlers.onData(String(event.data))
      }
    }
    ws.onclose = () => {
      handlers.onStatus?.('closed')
      if (closedByUser) return
      attempts++
      if (attempts <= 5) window.setTimeout(connect, 800 * attempts)
    }
    ws.onerror = () => ws?.close()
  }

  connect()

  return {
    send(data) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data))
    },
    close() {
      closedByUser = true
      ws?.close()
    },
  }
}
