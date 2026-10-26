import type { ChatChunk, ProviderCredentials } from '@maestro/shared'
import { maskSecrets } from '../lib/logger'

export class AiError extends Error {
  code: string
  provider?: string
  status?: number
  details?: unknown

  constructor(code: string, message: string, opts?: { provider?: string; status?: number; details?: unknown }) {
    super(message)
    this.name = 'AiError'
    this.code = code
    this.provider = opts?.provider
    this.status = opts?.status
    this.details = opts?.details
  }
}

export interface RequestObservation {
  provider: string
  model: string
  endpoint: string
  status: number | 'error'
  latency_ms: number
  tokens_in?: number
  tokens_out?: number
  request?: string
  response_preview?: string
  error?: string
}

let observer: ((info: RequestObservation) => void) | null = null

export function setRequestObserver(fn: ((info: RequestObservation) => void) | null): void {
  observer = fn
}

export function observe(info: RequestObservation): void {
  try {
    observer?.(info)
  } catch {
    /* telemetry must never break a request */
  }
}

export function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}${suffix.startsWith('/') ? '' : '/'}${suffix}`
}

export function buildHeaders(p: ProviderCredentials, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...extra,
  }
  for (const header of p.extra_headers ?? []) {
    if (header.k?.trim()) headers[header.k.trim()] = header.v ?? ''
  }
  return headers
}

export function combineSignals(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new AiError('timeout', `Превышен таймаут запроса (${timeoutMs} мс)`))
  }, Math.max(1000, timeoutMs))
  const onAbort = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError('cancelled', 'Запрос отменён'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new AiError('cancelled', 'Запрос отменён'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function withCleanup(response: Response, cleanup: () => void): Response {
  if (!response.body) {
    cleanup()
    return response
  }
  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          cleanup()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        cleanup()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        cleanup()
      }
    },
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** Fetch with retry on 429 / 5xx, respecting Retry-After. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { provider?: string; timeoutMs: number; signal?: AbortSignal; attempts?: number },
): Promise<{ response: Response; durationMs: number; cleanup: () => void }> {
  const attempts = opts.attempts ?? 3
  const started = Date.now()
  let lastError: unknown = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const { signal, cancel } = combineSignals(opts.timeoutMs, opts.signal)
    try {
      const response = await fetch(url, { ...init, signal })
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === attempts - 1) {
        return { response: withCleanup(response, cancel), durationMs: Date.now() - started, cleanup: cancel }
      }
      await response.body?.cancel()
      const retryAfter = Number(response.headers.get('retry-after'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt
      cancel()
      await sleep(Math.min(delay, 15000), opts.signal)
    } catch (error) {
      cancel()
      lastError = error
      if (opts.signal?.aborted) {
        throw new AiError('cancelled', 'Запрос отменён', { provider: opts.provider })
      }
      if (error instanceof AiError && error.code === 'timeout') throw error
      if (attempt === attempts - 1) break
      await sleep(500 * 2 ** attempt, opts.signal)
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new AiError('network_error', `Сетевая ошибка: ${message}`, { provider: opts.provider })
}

export async function readErrorBody(response: Response, provider?: string): Promise<AiError> {
  let detail = ''
  let parsed: unknown
  try {
    detail = await response.text()
    try {
      parsed = JSON.parse(detail)
    } catch {
      parsed = undefined
    }
  } catch {
    detail = ''
  }
  const message =
    extractMessage(parsed) ?? (detail ? maskSecrets(detail.slice(0, 1200)) : `HTTP ${response.status}`)
  const code =
    response.status === 401 || response.status === 403
      ? 'auth_error'
      : response.status === 429
        ? 'rate_limit'
        : response.status === 404
          ? 'not_found'
          : response.status >= 500
            ? 'provider_error'
            : 'bad_request'
  return new AiError(code, message, { provider, status: response.status, details: parsed })
}

function extractMessage(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const err = obj.error
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
  }
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.detail === 'string') return obj.detail
  return null
}

/** Iterate SSE `data:` payloads from a streaming response. */
export async function* iterateSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = findBoundary(buffer)
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + (buffer.startsWith('\r\n\r\n', boundary) ? 4 : 2))
        const data = extractData(raw)
        if (data !== null) yield data
        boundary = findBoundary(buffer)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const data = extractData(buffer)
      if (data !== null) yield data
    }
  } finally {
    reader.releaseLock()
  }
}

function findBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}

function extractData(block: string): string | null {
  const lines = block.split(/\r?\n/)
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    else if (line.startsWith('{')) dataLines.push(line)
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Accumulate streaming tool-call deltas into complete calls. */
export class ToolCallAccumulator {
  private calls = new Map<number, { id: string; name: string; arguments: string }>()

  push(chunk: Extract<ChatChunk, { type: 'tool_call_delta' }>): void {
    const current = this.calls.get(chunk.index) ?? { id: '', name: '', arguments: '' }
    if (chunk.id) current.id = chunk.id
    if (chunk.name) current.name = chunk.name
    if (chunk.arguments) current.arguments += chunk.arguments
    this.calls.set(chunk.index, current)
  }

  result(): Array<{ id: string; name: string; arguments: string }> {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      }))
      .filter((call) => call.name)
  }

  get size(): number {
    return this.calls.size
  }
}
