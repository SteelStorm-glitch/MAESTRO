import type { FastifyInstance } from 'fastify'
import { createModel, deleteModel, listModels, updateModel } from '../db/repo/models'
import { getProvider } from '../db/repo/providers'
import { badRequest, notFound } from '../http/errors'

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { provider?: string } }>('/api/models', async (request) => {
    return listModels(request.query.provider)
  })

  app.post('/api/models', async (request, reply) => {
    const data = (request.body ?? {}) as Record<string, unknown>
    const providerId = String(data.provider_id ?? '')
    if (!providerId || !getProvider(providerId)) throw badRequest('Укажите существующего провайдера')
    const modelId = String(data.model_id ?? '').trim()
    if (!modelId) throw badRequest('Укажите model_id')
    const model = createModel({
      provider_id: providerId,
      model_id: modelId,
      display_name: data.display_name ? String(data.display_name) : undefined,
      context_window: data.context_window ? Number(data.context_window) : undefined,
      max_output: data.max_output ? Number(data.max_output) : undefined,
      supports_tools: data.supports_tools !== false,
      supports_vision: Boolean(data.supports_vision),
      enabled: data.enabled !== false,
    })
    reply.code(201)
    return model
  })

  app.patch<{ Params: { id: string } }>('/api/models/:id', async (request) => {
    const updated = updateModel(request.params.id, (request.body ?? {}) as never)
    if (!updated) throw notFound('Модель не найдена')
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/models/:id', async (request, reply) => {
    if (!deleteModel(request.params.id)) throw notFound('Модель не найдена')
    reply.code(204)
    return null
  })
}
