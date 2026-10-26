import type { FastifyInstance } from 'fastify'
import type { ProviderInput, ProviderProtocol, RemoteModel } from '@maestro/shared'
import {
  createProvider,
  deleteProvider,
  getProvider,
  getProviderCredentials,
  listProviders,
  updateProvider,
} from '../db/repo/providers'
import { importRemoteModels, listModels } from '../db/repo/models'
import { getAdapter } from '../providers/registry'
import { badRequest, notFound, toHttpError } from '../http/errors'

const PROTOCOLS: ProviderProtocol[] = ['openai-compatible', 'anthropic', 'gemini']

function parseProviderInput(body: unknown): ProviderInput {
  const data = (body ?? {}) as Record<string, unknown>
  const name = String(data.name ?? '').trim()
  const protocol = String(data.protocol ?? 'openai-compatible') as ProviderProtocol
  const baseUrl = String(data.base_url ?? '').trim()
  if (!name) throw badRequest('Укажите имя провайдера')
  if (!PROTOCOLS.includes(protocol)) throw badRequest(`Неизвестный протокол: ${protocol}`)
  if (!/^https?:\/\//i.test(baseUrl)) throw badRequest('Base URL должен начинаться с http:// или https://')
  const headersRaw = data.extra_headers
  const extra_headers = Array.isArray(headersRaw)
    ? headersRaw
        .map((item) => {
          const h = (item ?? {}) as Record<string, unknown>
          return { k: String(h.k ?? h.key ?? '').trim(), v: String(h.v ?? h.value ?? '') }
        })
        .filter((header) => header.k)
    : []
  return {
    name,
    protocol,
    base_url: baseUrl,
    api_key: typeof data.api_key === 'string' ? data.api_key : data.api_key === null ? null : undefined,
    extra_headers,
    timeout_ms: typeof data.timeout_ms === 'number' ? data.timeout_ms : undefined,
  }
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/providers', async () => listProviders())

  app.get('/api/providers/export', async () => {
    // Keys and auth-like headers never leave the machine.
    const providers = listProviders().map((provider) => ({
      name: provider.name,
      protocol: provider.protocol,
      base_url: provider.base_url,
      extra_headers: provider.extra_headers.filter(
        (header) => !/authorization|api-?key|token|secret/i.test(header.k),
      ),
      timeout_ms: provider.timeout_ms,
      models: listModels(provider.id).map((model) => ({
        model_id: model.model_id,
        display_name: model.display_name,
        context_window: model.context_window,
        max_output: model.max_output,
        supports_tools: model.supports_tools,
        supports_vision: model.supports_vision,
        enabled: model.enabled,
      })),
    }))
    return { version: 1, exported_at: new Date().toISOString(), providers }
  })

  app.post('/api/providers/import', async (request) => {
    const body = (request.body ?? {}) as { providers?: unknown[] }
    const list = Array.isArray(body.providers) ? body.providers : Array.isArray(request.body) ? request.body : []
    if (list.length === 0) throw badRequest('Нет провайдеров для импорта')
    const created: string[] = []
    for (const item of list) {
      const parsed = parseProviderInput({ api_key: null, ...(item as Record<string, unknown>) })
      const provider = createProvider(parsed)
      created.push(provider.id)
      if (Array.isArray((item as Record<string, unknown>).models)) importRemoteModels(provider.id, (item as Record<string, unknown>).models as RemoteModel[])
    }
    return { imported: created.length, provider_ids: created }
  })

  app.get<{ Params: { id: string } }>('/api/providers/:id', async (request) => {
    const provider = getProvider(request.params.id)
    if (!provider) throw notFound('Провайдер не найден')
    return provider
  })

  app.post('/api/providers', async (request, reply) => {
    try {
      const provider = createProvider(parseProviderInput(request.body))
      reply.code(201)
      return provider
    } catch (error) {
      throw toHttpError(error)
    }
  })

  app.patch<{ Params: { id: string } }>('/api/providers/:id', async (request) => {
    const current = getProvider(request.params.id)
    if (!current) throw notFound('Провайдер не найден')
    const data = (request.body ?? {}) as Record<string, unknown>
    const input: Partial<ProviderInput> = {}
    if (data.name !== undefined) input.name = String(data.name)
    if (data.protocol !== undefined) {
      if (!PROTOCOLS.includes(String(data.protocol) as ProviderProtocol)) throw badRequest('Неизвестный протокол')
      input.protocol = String(data.protocol) as ProviderProtocol
    }
    if (data.base_url !== undefined) {
      if (!/^https?:\/\//i.test(String(data.base_url))) throw badRequest('Base URL должен начинаться с http:// или https://')
      input.base_url = String(data.base_url)
    }
    if (data.api_key !== undefined) {
      input.api_key = data.api_key === null || data.api_key === '' ? null : String(data.api_key)
    }
    if (Array.isArray(data.extra_headers)) {
      input.extra_headers = (data.extra_headers as Array<Record<string, unknown>>)
        .map((header) => ({ k: String(header.k ?? header.key ?? ''), v: String(header.v ?? header.value ?? '') }))
        .filter((header) => header.k)
    }
    if (data.timeout_ms !== undefined) input.timeout_ms = Number(data.timeout_ms)
    const updated = updateProvider(request.params.id, input)
    if (!updated) throw notFound('Провайдер не найден')
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/providers/:id', async (request, reply) => {
    if (!deleteProvider(request.params.id)) throw notFound('Провайдер не найден')
    reply.code(204)
    return null
  })

  app.post<{ Params: { id: string } }>('/api/providers/:id/test', async (request) => {
    const credentials = getProviderCredentials(request.params.id)
    if (!credentials) throw notFound('Провайдер не найден')
    const adapter = getAdapter(credentials.protocol)
    return adapter.testConnection(credentials)
  })

  app.get<{ Params: { id: string } }>('/api/providers/:id/models-remote', async (request) => {
    const credentials = getProviderCredentials(request.params.id)
    if (!credentials) throw notFound('Провайдер не найден')
    const adapter = getAdapter(credentials.protocol)
    if (!adapter.listModels) throw badRequest('Провайдер не поддерживает список моделей')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(credentials.timeout_ms, 20000))
    try {
      return await adapter.listModels(credentials, controller.signal)
    } catch (error) {
      throw toHttpError(error)
    } finally {
      clearTimeout(timer)
    }
  })

  app.post<{ Params: { id: string } }>('/api/providers/:id/models-import', async (request) => {
    if (!getProvider(request.params.id)) throw notFound('Провайдер не найден')
    const body = (request.body ?? {}) as { models?: RemoteModel[] }
    if (!Array.isArray(body.models)) throw badRequest('Ожидается { models: [...] }')
    return importRemoteModels(request.params.id, body.models)
  })
}
