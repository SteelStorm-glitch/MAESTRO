import { and, asc, eq } from 'drizzle-orm'
import type { Model, ModelInput, RemoteModel } from '@maestro/shared'
import { getDb } from '../client'
import { models, type ModelRow } from '../schema'
import { newId } from '../../lib/crypto'

export function toModel(row: ModelRow): Model {
  return {
    id: row.id,
    provider_id: row.providerId,
    model_id: row.modelId,
    display_name: row.displayName,
    context_window: row.contextWindow,
    max_output: row.maxOutput,
    supports_tools: Boolean(row.supportsTools),
    supports_vision: Boolean(row.supportsVision),
    enabled: Boolean(row.enabled),
  }
}

export function listModels(providerId?: string): Model[] {
  const db = getDb()
  const query = providerId
    ? db.select().from(models).where(eq(models.providerId, providerId))
    : db.select().from(models)
  return query.orderBy(asc(models.displayName)).all().map(toModel)
}

export function getModelRow(id: string): ModelRow | null {
  return getDb().select().from(models).where(eq(models.id, id)).get() ?? null
}

export function getModel(id: string): Model | null {
  const row = getModelRow(id)
  return row ? toModel(row) : null
}

export function createModel(input: ModelInput): Model {
  const id = newId('mdl')
  getDb()
    .insert(models)
    .values({
      id,
      providerId: input.provider_id,
      modelId: input.model_id,
      displayName: input.display_name?.trim() || input.model_id,
      contextWindow: input.context_window ?? 128000,
      maxOutput: input.max_output ?? 8192,
      supportsTools: input.supports_tools === false ? 0 : 1,
      supportsVision: input.supports_vision ? 1 : 0,
      enabled: input.enabled === false ? 0 : 1,
    })
    .run()
  return getModel(id)!
}

export function updateModel(id: string, input: Partial<ModelInput>): Model | null {
  const row = getModelRow(id)
  if (!row) return null
  const values: Partial<ModelRow> = {}
  if (input.model_id !== undefined) values.modelId = input.model_id
  if (input.display_name !== undefined) values.displayName = input.display_name
  if (input.context_window !== undefined) values.contextWindow = input.context_window
  if (input.max_output !== undefined) values.maxOutput = input.max_output
  if (input.supports_tools !== undefined) values.supportsTools = input.supports_tools ? 1 : 0
  if (input.supports_vision !== undefined) values.supportsVision = input.supports_vision ? 1 : 0
  if (input.enabled !== undefined) values.enabled = input.enabled ? 1 : 0
  getDb().update(models).set(values).where(eq(models.id, id)).run()
  return getModel(id)
}

export function deleteModel(id: string): boolean {
  return getDb().delete(models).where(eq(models.id, id)).run().changes > 0
}

/**
 * Merge a remote model list: add missing entries, keep local flags (enabled/tools/vision)
 * for models that already exist. Never deletes local models automatically.
 */
export function importRemoteModels(providerId: string, remote: RemoteModel[]): Model[] {
  const db = getDb()
  const existing = db.select().from(models).where(eq(models.providerId, providerId)).all()
  const byModelId = new Map(existing.map((row) => [row.modelId, row]))
  const nowIds: string[] = []
  for (const item of remote) {
    const found = byModelId.get(item.id)
    if (found) {
      db.update(models)
        .set({
          displayName: item.display_name?.trim() || found.displayName,
          contextWindow: item.context_window ?? found.contextWindow,
        })
        .where(eq(models.id, found.id))
        .run()
    } else {
      const id = newId('mdl')
      db.insert(models)
        .values({
          id,
          providerId,
          modelId: item.id,
          displayName: item.display_name?.trim() || item.id,
          contextWindow: item.context_window ?? 128000,
          maxOutput: 8192,
          supportsTools: 1,
          supportsVision: 0,
          enabled: 1,
        })
        .run()
      nowIds.push(id)
    }
  }
  return listModels(providerId)
}

export function enabledModelsByProvider(providerId: string): Model[] {
  return getDb()
    .select()
    .from(models)
    .where(and(eq(models.providerId, providerId), eq(models.enabled, 1)))
    .all()
    .map(toModel)
}
