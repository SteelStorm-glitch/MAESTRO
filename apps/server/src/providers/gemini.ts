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

interface GeminiPart {
  text?: string
  functionCall?: { name?: string; args?: Record<string, unknown> }
  functionResponse?: { name?: string; response?: Record<string, unknown> }
}

interface GeminiStreamEvent {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string }
    finishReason?: string
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { code?: number; message?: string; status?: string }
}

function geminiBase(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, '')
  return /\/v1beta$/.test(clean) ? clean : `${clean}/v1beta`
}

/** Gemini rejects several JSON-Schema keywords; strip the ones known to break requests. */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (['$schema', '$id', 'additionalProperties', 'definitions', '$defs', 'examples', 'default'].includes(key)) continue
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propName] = cleanSchema(propSchema)
      }
      out.properties = props
      continue
    }
    out[key] = key === 'items' ? cleanSchema(value) : value
  }
  return out
}

export function buildContents(messages: ChatMessage[]): { system: string; contents: Array<{ role: string; parts: GeminiPart[] }> } {
  const systemParts: string[] = []
  const contents: Array<{ role: string; parts: GeminiPart[] }> = []

  const push = (role: string, parts: GeminiPart[]) => {
    if (parts.length === 0) return
    const last = contents[contents.length - 1]
    if (
      last &&
      last.role === role &&
      (role === 'user' ||
        role === 'function' ||
        (parts.every((p) => typeof p.text === 'string') && last.parts.every((p) => typeof p.text === 'string')))
    ) {
      last.parts.push(...parts)
      return
    }
    contents.push({ role, parts })
  }

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      let response: Record<string, unknown> = { result: message.content }
      try {
        const parsed = JSON.parse(message.content)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          response = parsed as Record<string, unknown>
        }
      } catch {
        /* keep wrapped result */
      }
      push('function', [{ functionResponse: { name: message.name ?? 'tool', response } }])
      continue
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.tool_calls ?? []) {
        let args: Record<string, unknown> = {}
        try {
          const parsed = JSON.parse(call.arguments || '{}')
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
        } catch {
          args = { raw: call.arguments }
        }
        parts.push({ functionCall: { name: call.name, args } })
      }
      push('model', parts)
      continue
    }
    push('user', [{ text: message.content }])
  }

  return { system: systemParts.join('\n\n').trim(), contents }
}

function buildBody(req: ChatRequest) {
  const { system, contents } = buildContents(req.messages)
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
      ...(typeof req.max_tokens === 'number' ? { maxOutputTokens: req.max_tokens } : {}),
    },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  if (req.tools && req.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: cleanSchema(tool.parameters),
        })),
      },
    ]
  }
  return body
}

export const geminiAdapter: ProviderAdapter = {
  protocol: 'gemini',

  async listModels(p: ProviderCredentials, signal?: AbortSignal): Promise<RemoteModelInfo[]> {
    const endpoint = joinUrl(geminiBase(p.base_url), '/models?pageSize=200')
    const { response } = await fetchWithRetry(
      endpoint,
      { method: 'GET', headers: buildHeaders(p, p.api_key ? { 'x-goog-api-key': p.api_key } : {}) },
      { provider: p.name, timeoutMs: p.timeout_ms, signal, attempts: 2 },
    )
    if (!response.ok) throw await readErrorBody(response, p.name)
    const data = (await response.json()) as {
      models?: Array<{
        name?: string
        displayName?: string
        inputTokenLimit?: number
        supportedGenerationMethods?: string[]
      }>
    }
    return (data.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => ({
        id: String(m.name ?? '').replace(/^models\//, ''),
        display_name: m.displayName ?? String(m.name ?? '').replace(/^models\//, ''),
        context_window: m.inputTokenLimit,
      }))
      .filter((m) => m.id)
  },

  async testConnection(p: ProviderCredentials) {
    const started = Date.now()
    try {
      const endpoint = joinUrl(geminiBase(p.base_url), '/models?pageSize=1')
      const { response } = await fetchWithRetry(
        endpoint,
        { method: 'GET', headers: buildHeaders(p, p.api_key ? { 'x-goog-api-key': p.api_key } : {}) },
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
    const endpoint = joinUrl(geminiBase(p.base_url), `/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`)
    const headers = buildHeaders(p, p.api_key ? { 'x-goog-api-key': p.api_key } : {})
    const started = Date.now()
    const requestPreview = maskSecrets(JSON.stringify({ model: modelId, messages: req.messages }).slice(0, 4000))

    const { response, durationMs } = await fetchWithRetry(
      endpoint,
      { method: 'POST', headers, body: JSON.stringify(buildBody(req)) },
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

    let usageIn: number | undefined
    let usageOut: number | undefined
    let outputText = ''
    let responsePreview = ''
    let toolIndex = 0
    let doneSent = false

    try {
      for await (const data of iterateSSE(response.body)) {
        const event = safeJsonParse<GeminiStreamEvent>(data)
        if (!event) continue
        responsePreview += data
        if (event.error) {
          throw new AiError(event.error.status?.toLowerCase() ?? 'provider_error', event.error.message ?? 'Ошибка Gemini', {
            provider: p.name,
            status: event.error.code,
          })
        }
        usageIn = event.usageMetadata?.promptTokenCount ?? usageIn
        usageOut = event.usageMetadata?.candidatesTokenCount ?? usageOut
        for (const candidate of event.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (typeof part.text === 'string' && part.text) {
              outputText += part.text
              yield { type: 'text', text: part.text }
            }
            if (part.functionCall?.name) {
              const index = toolIndex++
              yield {
                type: 'tool_call_delta',
                index,
                id: `call_${index}_${part.functionCall.name}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args ?? {}),
              }
            }
          }
          if (candidate.finishReason) {
            yield { type: 'done', finish_reason: candidate.finishReason }
            doneSent = true
          }
        }
      }

      const effectiveIn = usageIn ?? estimateMessagesTokens(req.messages)
      const effectiveOut = usageOut ?? estimateTokens(outputText)
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
