import { and, desc, eq, gte, inArray, like, or, sql, type SQL } from 'drizzle-orm'
import type { EventRecord, EventType } from '@maestro/shared'
import { getDb } from '../client'
import { events, type EventRow } from '../schema'
import { newId } from '../../lib/crypto'
import { logger } from '../../lib/logger'

function toEvent(row: EventRow): EventRecord {
  let payload: unknown = {}
  try {
    payload = JSON.parse(row.payloadJson)
  } catch {
    payload = {}
  }
  return {
    id: row.id,
    session_id: row.sessionId,
    type: row.type as EventType,
    payload,
    created_at: row.createdAt,
  }
}

export function insertEvent(input: {
  session_id?: string | null
  type: EventType
  payload?: unknown
}): EventRecord {
  const record: EventRecord = {
    id: newId('evt'),
    session_id: input.session_id ?? null,
    type: input.type,
    payload: input.payload ?? {},
    created_at: Date.now(),
  }
  try {
    getDb()
      .insert(events)
      .values({
        id: record.id,
        sessionId: record.session_id,
        type: record.type,
        payloadJson: JSON.stringify(record.payload),
        createdAt: record.created_at,
      })
      .run()
  } catch (error) {
    logger.warn('Failed to persist event', { type: record.type, error: String(error) })
  }
  return record
}

export function listEvents(filters: {
  sessionId?: string
  types?: string[]
  limit?: number
  since?: number
  query?: string
}): EventRecord[] {
  const db = getDb()
  const conditions: SQL[] = []
  if (filters.sessionId) conditions.push(eq(events.sessionId, filters.sessionId))
  if (filters.types && filters.types.length > 0) conditions.push(inArray(events.type, filters.types))
  if (filters.since) conditions.push(gte(events.createdAt, filters.since))
  if (filters.query) {
    const q = `%${filters.query}%`
    conditions.push(or(like(events.payloadJson, q), like(events.type, q))!)
  }
  const limit = Math.min(filters.limit ?? 500, 5000)
  const where = conditions.length > 0 ? and(...conditions) : undefined
  const base = db.select().from(events)
  const rows = where
    ? base.where(where).orderBy(desc(events.createdAt)).limit(limit).all()
    : base.orderBy(desc(events.createdAt)).limit(limit).all()
  return rows.map(toEvent).reverse()
}

export function clearEvents(sessionId?: string): void {
  if (sessionId) getDb().delete(events).where(eq(events.sessionId, sessionId)).run()
  else getDb().delete(events).run()
}

export function countEvents(sessionId?: string): number {
  const db = getDb()
  const query = db.select({ value: sql<number>`count(*)` }).from(events)
  const row = sessionId ? query.where(eq(events.sessionId, sessionId)).get() : query.get()
  return row?.value ?? 0
}
