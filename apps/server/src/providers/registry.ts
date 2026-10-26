import type { ProviderAdapter, ProviderProtocol } from '@maestro/shared'
import { getProviderCredentials } from '../db/repo/providers'
import { getModel } from '../db/repo/models'
import { AiError } from './base'
import { openaiAdapter } from './openai'
import { anthropicAdapter } from './anthropic'
import { geminiAdapter } from './gemini'

const adapters: Record<ProviderProtocol, ProviderAdapter> = {
  'openai-compatible': openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
}

export function getAdapter(protocol: string): ProviderAdapter {
  const adapter = adapters[protocol as ProviderProtocol]
  if (!adapter) throw new AiError('unsupported_protocol', `Неизвестный протокол провайдера: ${protocol}`)
  return adapter
}

export interface ResolvedModel {
  modelDbId: string
  modelId: string
  contextWindow: number
  maxOutput: number
  supportsTools: boolean
  providerId: string
  providerName: string
  adapter: ProviderAdapter
  credentials: ReturnType<typeof getProviderCredentials> & object
}

/** Resolve a model row + provider credentials into everything the engine needs for a call. */
export function resolveModel(modelDbId: string): ResolvedModel {
  const model = getModel(modelDbId)
  if (!model) throw new AiError('model_not_found', 'Модель не найдена')
  if (!model.enabled) throw new AiError('model_disabled', 'Модель отключена')
  const credentials = getProviderCredentials(model.provider_id)
  if (!credentials) throw new AiError('provider_not_found', 'Провайдер модели не найден')
  return {
    modelDbId: model.id,
    modelId: model.model_id,
    contextWindow: model.context_window,
    maxOutput: model.max_output,
    supportsTools: model.supports_tools,
    providerId: model.provider_id,
    providerName: credentials.name,
    adapter: getAdapter(credentials.protocol),
    credentials,
  }
}

/** Rough per-1M-token price used only for the dashboard. Unknown providers get a sane default. */
export function estimateCost(modelId: string, tokensIn: number, tokensOut: number): number {
  const table: Array<[RegExp, number, number]> = [
    [/opus/i, 15, 75],
    [/sonnet/i, 3, 15],
    [/haiku/i, 0.8, 4],
    [/gpt-4o(?!-mini)/i, 2.5, 10],
    [/gpt-4o-mini/i, 0.15, 0.6],
    [/deepseek/i, 0.27, 1.1],
    [/gemini-2\.5-pro/i, 1.25, 10],
    [/gemini-2\.5-flash/i, 0.3, 2.5],
    [/gemini/i, 0.5, 2],
    [/llama|mistral|qwen/i, 0.2, 0.6],
  ]
  for (const [re, input, output] of table) {
    if (re.test(modelId)) return (tokensIn / 1_000_000) * input + (tokensOut / 1_000_000) * output
  }
  return (tokensIn / 1_000_000) * 0.5 + (tokensOut / 1_000_000) * 1.5
}
