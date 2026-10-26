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
import {
  AiError,
  buildHeaders,
  fetchWithRetry,
  iterateSSE,
  joinUrl,
  observe,
  readErrorBody,
  safeJsonParse,
} from './base'

interface OpenAIDelta {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function contentToText(content: ChatMessage['content']): string {
  return content
}

function mapMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id ?? m.name ?? 'call_0',
        content: m.content,
      }
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: contentToText(m.content) || null,
        tool_calls: m.tool_calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

function deltaText(delta: NonNullable<OpenAIDelta['choices']>[number]): string {
  const content = delta.delta?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
  }
  return ''
}

function buildBody(model: string, req: ChatRequest, withStreamOptions: boolean) {
  const body: Record<string, unknown> = {
    model,
    messages: mapMessages(req.messages),
    stream: true,
  }
  if (withStreamOptions) body.stream_options = { include_usage: true }
  if (typeof req.temperature === 'number') body.temperature = req.temperature
  if (typeof req.max_tokens === 'number') body.max_tokens = req.max_tokens
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
    body.tool_choice = 'auto'
  }
  return body
}

export const openaiAdapter: ProviderAdapter = {
  protocol: 'openai-compatible',

  async listModels(p: ProviderCredentials, signal?: AbortSignal): Promise<RemoteModelInfo[]> {
    const endpoint = joinUrl(p.base_url, '/models')
    const { response } = await fetchWithRetry(
      endpoint,
      { method: 'GET', headers: buildHeaders(p, p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}) },
      { provider: p.name, timeoutMs: p.timeout_ms, signal, attempts: 2 },
    )
    if (!response.ok) throw await readErrorBody(response, p.name)
    const data = (await response.json()) as { data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
    const list = Array.isArray(data) ? data : (data.data ?? [])
    const result: RemoteModelInfo[] = []
    for (const item of list) {
      const id = String(item.id ?? item.model ?? '')
      if (!id) continue
      const context = Number(
        item.context_length ?? item.context_window ?? item.max_context_length ?? item.max_input_tokens ?? 0,
      )
      result.push({
        id,
        display_name: typeof item.name === 'string' ? item.name : id,
        context_window: Number.isFinite(context) && context > 0 ? context : undefined,
      })
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  },

  async testConnection(p: ProviderCredentials) {
    const started = Date.now()
    try {
      const endpoint = joinUrl(p.base_url, '/models')
      const { response } = await fetchWithRetry(
        endpoint,
        {
          method: 'GET',
          headers: buildHeaders(p, p.api_key ? { authorization: `Bearer ${p.api_key}` } : {}),
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
    const endpoint = joinUrl(p.base_url, '/chat/completions')
    const headers = buildHeaders(p, p.api_key ? { authorization: `Bearer ${p.api_key}` } : {})
    const started = Date.now()
    const requestPreview = maskSecrets(JSON.stringify({ model: modelId, messages: req.messages }).slice(0, 4000))
    let attemptWithOptions = true
    let response: Response
    let durationMs = 0

    for (;;) {
      const result = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(modelId, req, attemptWithOptions)),
        },
        { provider: p.name, timeoutMs: p.timeout_ms, signal, attempts: 3 },
      )
      response = result.response
      durationMs = result.durationMs
      if (!response.ok) {
        const err = await readErrorBody(response, p.name)
        const retryWithoutOptions =
          attemptWithOptions &&
          response.status === 400 &&
          /stream_options|include_usage|unknown (field|parameter)|unrecognized/i.test(err.message)
        if (retryWithoutOptions) {
          attemptWithOptions = false
          continue
        }
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
      break
    }

    if (!response.body) throw new AiError('empty_response', 'Провайдер вернул пустой поток', { provider: p.name })

    let outputText = ''
    let usageIn: number | undefined
    let usageOut: number | undefined
    let responsePreview = ''
    let sawDone = false

    try {
      for await (const data of iterateSSE(response.body)) {
        if (data.trim() === '[DONE]') {
          sawDone = true
          break
        }
        const parsed = safeJsonParse<OpenAIDelta>(data)
        if (!parsed) continue
        responsePreview += data
        if (parsed.usage) {
          usageIn = parsed.usage.prompt_tokens ?? usageIn
          usageOut = parsed.usage.completion_tokens ?? usageOut
        }
        for (const choice of parsed.choices ?? []) {
          const text = deltaText(choice)
          if (text) {
            outputText += text
            yield { type: 'text', text }
          }
          for (const call of choice.delta?.tool_calls ?? []) {
            yield {
              type: 'tool_call_delta',
              index: call.index ?? 0,
              id: call.id,
              name: call.function?.name,
              arguments: call.function?.arguments,
            }
          }
          if (choice.finish_reason) {
            yield { type: 'done', finish_reason: choice.finish_reason }
          }
        }
      }

      const inputTokens = usageIn ?? estimateMessagesTokens(req.messages)
      const outputTokens = usageOut ?? estimateTokens(outputText)
      yield { type: 'usage', usage: { input_tokens: inputTokens, output_tokens: outputTokens } }
      observe({
        provider: p.name ?? p.protocol,
        model: modelId,
        endpoint,
        status: response.status,
        latency_ms: durationMs,
        tokens_in: inputTokens,
        tokens_out: outputTokens,
        request: requestPreview,
        response_preview: maskSecrets(responsePreview.slice(0, 2000)),
      })
      if (!sawDone) yield { type: 'done' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (signal?.aborted) throw new AiError('cancelled', 'Запрос отменён', { provider: p.name })
      observe({
        provider: p.name ?? p.protocol,
        model: modelId,
        endpoint,
        status: 'error',
        latency_ms: Date.now() - started,
        request: requestPreview,
        response_preview: responsePreview.slice(0, 2000),
        error: message,
      })
      throw error instanceof AiError ? error : new AiError('stream_error', message, { provider: p.name })
    }
  },
}
