import type { ProviderProtocol } from './types'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Provider-native tool calls produced by the assistant. */
  tool_calls?: ToolCall[]
  /** For role=tool: which call this result belongs to. */
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
  max_tokens?: number
  /** Provider-specific extras (e.g. anthropic thinking). */
  extra?: Record<string, unknown>
}

export interface Usage {
  input_tokens: number
  output_tokens: number
}

export type ChatChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; finish_reason?: string }
  | { type: 'error'; error: { code: string; message: string } }

export interface ProviderCredentials {
  protocol: ProviderProtocol
  base_url: string
  api_key: string | null
  extra_headers: Array<{ k: string; v: string }>
  timeout_ms: number
  name?: string
}

export interface RemoteModelInfo {
  id: string
  display_name?: string
  context_window?: number
}

export interface ProviderAdapter {
  protocol: ProviderProtocol
  listModels?(p: ProviderCredentials, signal?: AbortSignal): Promise<RemoteModelInfo[]>
  testConnection(p: ProviderCredentials, model?: string): Promise<{ ok: boolean; error?: string; latencyMs: number }>
  chat(
    p: ProviderCredentials,
    modelId: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatChunk>
}

/** Normalised provider error shape used across the app. */
export interface ProviderError {
  code: string
  message: string
  provider?: string
  status?: number
}

export function providerError(code: string, message: string, extra?: Partial<ProviderError>): ProviderError {
  return { code, message, ...extra }
}
