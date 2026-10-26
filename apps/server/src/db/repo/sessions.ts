import { desc, eq, isNull, sql } from 'drizzle-orm'
import type { Session, SessionStatus } from '@maestro/shared'
import { getDb } from '../client'
import { sessions, type SessionRow } from '../schema'
import { newId } from '../../lib/crypto'

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    project_id: row.projectId,
    orchestra_id: row.orchestraId,
    title: row.title,
    status: row.status as SessionStatus,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost: row.cost,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export function listSessions(projectId?: string): Session[] {
  const db = getDb()
  const query = projectId
    ? db.select().from(sessions).where(eq(sessions.projectId, projectId))
    : db.select().from(sessions)
  return query.orderBy(desc(sessions.updatedAt)).all().map(toSession)
}

export function getSession(id: string): Session | null {
  const row = getDb().select().from(sessions).where(eq(sessions.id, id)).get()
  return row ? toSession(row) : null
}

export function createSession(input: { project_id: string; orchestra_id: string; title?: string }): Session {
  const id = newId('ses')
  const now = Date.now()
  getDb()
    .insert(sessions)
    .values({
      id,
      projectId: input.project_id,
      orchestraId: input.orchestra_id,
      title: input.title?.trim() || 'Новый запуск',
      status: 'idle',
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return getSession(id)!
}

export function updateSession(
  id: string,
  input: Partial<{
    title: string
    status: SessionStatus
    tokens_in: number
    tokens_out: number
    cost: number
    touch: boolean
  }>,
): Session | null {
  const values: Partial<SessionRow> = {}
  if (input.title !== undefined) values.title = input.title
  if (input.status !== undefined) values.status = input.status
  if (input.tokens_in !== undefined) values.tokensIn = input.tokens_in
  if (input.tokens_out !== undefined) values.tokensOut = input.tokens_out
  if (input.cost !== undefined) values.cost = input.cost
  if (input.touch !== false) values.updatedAt = Date.now()
  if (Object.keys(values).length > 0) {
    getDb().update(sessions).set(values).where(eq(sessions.id, id)).run()
  }
  return getSession(id)
}

export function addSessionUsage(id: string, tokensIn: number, tokensOut: number, cost: number): Session | null {
  getDb()
    .update(sessions)
    .set({
      tokensIn: sql`${sessions.tokensIn} + ${Math.round(tokensIn)}`,
      tokensOut: sql`${sessions.tokensOut} + ${Math.round(tokensOut)}`,
      cost: sql`${sessions.cost} + ${cost}`,
      updatedAt: Date.now(),
    })
    .where(eq(sessions.id, id))
    .run()
  return getSession(id)
}

export function deleteSession(id: string): boolean {
  return getDb().delete(sessions).where(eq(sessions.id, id)).run().changes > 0
}

/** On boot, any session left "running"/"paused" cannot be resumed by the engine. */
export function resetStaleSessions(): number {
  const db = getDb()
  const stale = db
    .select()
    .from(sessions)
    .where(eq(sessions.status, 'running'))
    .all()
  db.update(sessions).set({ status: 'error' }).where(eq(sessions.status, 'running')).run()
  const stalePaused = db.select().from(sessions).where(eq(sessions.status, 'paused')).all()
  db.update(sessions).set({ status: 'error' }).where(eq(sessions.status, 'paused')).run()
  void isNull
  return stale.length + stalePaused.length
}
