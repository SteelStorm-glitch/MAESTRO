import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ProviderAdapter,
  ProviderCredentials,
  RemoteModelInfo,
} from '@maestro/shared'
import { estimateMessagesTokens, estimateTokens } from '../lib/tokens'
import { maskSecrets } from '../lib/logger'
import { AiError, buildHeaders, fetchWithRetry, iterateSSE, joinUrl, observe, readErrorBody, safeJsonParse } from './base'

type Block = Record<string, unknown>

function anthropicEndpoint(baseUrl: string, path: string): string {
  const clean = baseUrl.replace(/\/+$/, '')
  return /\/v1$/.test(clean) ? joinUrl(clean, path) : joinUrl(clean, `/v1${path}`)
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { _raw: raw }
  }
}

function buildMessages(messages: ChatMessage[]): { system: string; messages: Array<{ role: string; content: string | Block[] }> } {
  const systemParts: string[] = []
  const out: Array<{ role: string; content: string | Block[] }> = []

  const appendMerged = (role: 'user' | 'assistant', content: string | Block[]) => {
    const last = out[out.length - 1]
    if (last && last.role === role && typeof last.content === 'string' && typeof content === 'string') {
      last.content = `${last.content}\n\n${content}`
      return
    }
    out.push({ role, content })
  }

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      const block: Block = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id ?? 'call_0',
        content: message.content,
      }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (message.role === 'assistant') {
      const blocks: Block[] = []
      if (message.content) blocks.push({ type: 'text', text: message.content })
      for (const call of message.tool_calls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: parseArgs(call.arguments) })
      }
      if (blocks.length === 1 && blocks[0]?.type === 'text') appendMerged('assistant', String(blocks[0].text))
      else if (blocks.length > 0) out.push({ role: 'assistant', content: blocks })
      else appendMerged('assistant', message.content)
      continue
    }
    appendMerged('user', message.content)
  }

  return { system: systemParts.join('\n\n').trim(), messages: out }
}

function buildBody(model: string, req: ChatRequest) {
  const { system, messages } = buildMessages(req.messages)
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: req.max_tokens ?? 8192,
    stream: true,
  }
  if (system) body.system = system
  if (typeof req.temperature === 'number') body.temperature = req.temperature
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
  return body
}

interface AnthropicEvent {
  type?: string
  index?: number
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
  content_block?: { type?: string; id?: string; name?: string }
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string
  }
  usage?: { output_tokens?: number; input_tokens?: number }
  error?: { type?: string; message?: string }
}

export const anthropicAdapter: ProviderAdapter = {
  protocol: 'anthropic',

  async listModels(p: ProviderCredentials, signal?: AbortSignal): Promise<RemoteModelInfo[]> {
    const endpoint = anthropicEndpoint(p.base_url, '/models')
    const { response } = await fetchWithRetry(
      endpoint,
      {
        method: 'GET',
        headers: buildHeaders(p, {
          'x-api-key': p.api_key ?? '',
          'anthropic-version': '2023-06-01',
        }),
      },
      { provider: p.name, timeoutMs: p.timeout_ms, signal, attempts: 2 },
    )
    if (!response.ok) throw await readErrorBody(response, p.name)
    const data = (await response.json()) as { data?: Array<Record<string, unknown>> }
    return (data.data ?? [])
      .map((item) => ({
        id: String(item.id ?? ''),
        display_name: typeof item.display_name === 'string' ? item.display_name : String(item.id ?? ''),
        context_window: Number(item.context_window ?? 0) || undefined,
      }))
      .filter((item) => item.id)
  },

  async testConnection(p: ProviderCredentials) {
    const started = Date.now()
    try {
      const endpoint = anthropicEndpoint(p.base_url, '/models')
      const { response } = await fetchWithRetry(
        endpoint,
        {
          method: 'GET',
          headers: buildHeaders(p, {
            'x-api-key': p.api_key ?? '',
            'anthropic-version': '2023-06-01',
          }),
        },
        { provider: p.name, timeoutMs: Math.min(p.timeout_ms, 15000), attempts: 1 },
      )
      if (response.ok) return { ok: true, latencyMs: Date.now() - started }
      const error = await readErrorBody(response, p.name)
      return { ok: false, error: error.message, latencyMs: Date.now() - started }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      }
    }
  },

  async *chat(
    p: ProviderCredentials,
    modelId: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatChunk> {
    const endpoint = anthropicEndpoint(p.base_url, '/messages')
    const headers = buildHeaders(p, {
      'x-api-key': p.api_key ?? '',
      'anthropic-version': '2023-06-01',
      ...(p.extra_headers.some((h) => h.k.toLowerCase() === 'authorization')
        ? {}
        : p.api_key
          ? { authorization: `Bearer ${p.api_key}` }
          : {}),
    })
    const started = Date.now()
    const requestPreview = maskSecrets(JSON.stringify({ model: modelId, messages: req.messages }).slice(0, 4000))

    const { response, durationMs } = await fetchWithRetry(
      endpoint,
      { method: 'POST', headers, body: JSON.stringify(buildBody(modelId, req)) },
      { provider: p.name, timeoutMs: p.timeout_ms, signal, attempts: 3 },
    )
    if (!response.ok) {
      const err = await readErrorBody(response, p.name)
      observe({
        provider: p.name ?? p.protocol,
        model: modelId,
        endpoint,
        status: response.status,
        latency_ms: durationMs,
        request: requestPreview,
        error: err.message,
      })
      throw err
    }
    if (!response.body) throw new AiError('empty_response', 'Провайдер вернул пустой поток', { provider: p.name })

    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let outputText = ''
    let responsePreview = ''
    let doneSent = false

    try {
      for await (const data of iterateSSE(response.body)) {
        const event = safeJsonParse<AnthropicEvent>(data)
        if (!event) continue
        responsePreview += data
        switch (event.type) {
          case 'message_start':
            inputTokens = event.message?.usage?.input_tokens ?? inputTokens
            break
          case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
              yield {
                type: 'tool_call_delta',
                index: event.index ?? 0,
                id: event.content_block.id,
                name: event.content_block.name,
                arguments: '',
              }
            }
            break
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              outputText += event.delta.text
              yield { type: 'text', text: event.delta.text }
            } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
              yield {
                type: 'tool_call_delta',
                index: event.index ?? 0,
                arguments: event.delta.partial_json,
              }
            }
            break
          case 'message_delta':
            outputTokens = event.usage?.output_tokens ?? outputTokens
            if (event.delta?.stop_reason) {
              yield { type: 'done', finish_reason: event.delta.stop_reason }
              doneSent = true
            }
            break
          case 'error':
            throw new AiError(event.error?.type ?? 'provider_error', event.error?.message ?? 'Ошибка провайдера', {
              provider: p.name,
            })
          case 'message_stop':
            doneSent = true
            break
          default:
            break
        }
      }

      const effectiveIn = inputTokens ?? estimateMessagesTokens(req.messages)
      const effectiveOut = outputTokens ?? estimateTokens(outputText)
      yield { type: 'usage', usage: { input_tokens: effectiveIn, output_tokens: effectiveOut } }
      observe({
        provider: p.name ?? p.protocol,
        model: modelId,
        endpoint,
        status: response.status,
        latency_ms: durationMs,
        tokens_in: effectiveIn,
        tokens_out: effectiveOut,
        request: requestPreview,
        response_preview: maskSecrets(responsePreview.slice(0, 2000)),
      })
      if (!doneSent) yield { type: 'done' }
    } catch (error) {
      if (signal?.aborted) throw new AiError('cancelled', 'Запрос отменён', { provider: p.name })
      const message = error instanceof Error ? error.message : String(error)
      observe({
        provider: p.name ?? p.protocol,
        model: modelId,
        endpoint,
        status: 'error',
        latency_ms: Date.now() - started,
        request: requestPreview,
        response_preview: maskSecrets(responsePreview.slice(0, 2000)),
        error: message,
      })
      throw error instanceof AiError ? error : new AiError('stream_error', message, { provider: p.name })
    }
  },
}
