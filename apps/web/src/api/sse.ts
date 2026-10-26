export function openSessionStream(
  sessionId: string,
  onEnvelope: (envelope: unknown) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let source: EventSource | null = null
  let closed = false
  let retry = 0
  let retryTimer: number | null = null

  const connect = () => {
    if (closed) return
    source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`)
    source.onopen = () => {
      retry = 0
      onStatus?.(true)
    }
    source.onmessage = (event) => {
      if (!event.data) return
      try {
        onEnvelope(JSON.parse(event.data))
      } catch {
        /* ignore malformed frame */
      }
    }
    source.onerror = () => {
      onStatus?.(false)
      source?.close()
      if (closed) return
      retry = Math.min(retry + 1, 6)
      retryTimer = window.setTimeout(connect, 500 * 2 ** retry)
    }
  }

  connect()

  return () => {
    closed = true
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    source?.close()
  }
}

export function openFsStream(
  projectId: string,
  onChange: (change: unknown) => void,
): () => void {
  let source: EventSource | null = null
  let closed = false
  let retry = 0
  let retryTimer: number | null = null
  const connect = () => {
    if (closed) return
    source = new EventSource(`/api/fs/watch?project=${encodeURIComponent(projectId)}`)
    source.onmessage = (event) => {
      if (!event.data) return
      try {
        onChange(JSON.parse(event.data))
      } catch {
        /* ignore */
      }
    }
    source.onerror = () => {
      source?.close()
      if (closed) return
      retry = Math.min(retry + 1, 5)
      retryTimer = window.setTimeout(connect, 1000 * 2 ** retry)
    }
    source.onopen = () => {
      retry = 0
    }
  }
  connect()
  return () => {
    closed = true
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    source?.close()
  }
}
