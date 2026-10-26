import { asc, eq } from 'drizzle-orm'
import type { Task, TaskStatus } from '@maestro/shared'
import { getDb } from '../client'
import { tasks, type TaskRow } from '../schema'
import { newId } from '../../lib/crypto'

function parseDeps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    session_id: row.sessionId,
    parent_id: row.parentId,
    assigned_role_id: row.assignedRoleId,
    title: row.title,
    payload: row.payload,
    status: row.status as TaskStatus,
    depends_on: parseDeps(row.dependsOnJson),
    result: row.result,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export function listTasks(sessionId: string): Task[] {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.sessionId, sessionId))
    .orderBy(asc(tasks.createdAt))
    .all()
    .map(toTask)
}

export function getTask(id: string): Task | null {
  const row = getDb().select().from(tasks).where(eq(tasks.id, id)).get()
  return row ? toTask(row) : null
}

export function createTask(input: {
  session_id: string
  parent_id?: string | null
  assigned_role_id?: string | null
  title: string
  payload?: string
  depends_on?: string[]
  status?: TaskStatus
}): Task {
  const id = newId('tsk')
  const now = Date.now()
  getDb()
    .insert(tasks)
    .values({
      id,
      sessionId: input.session_id,
      parentId: input.parent_id ?? null,
      assignedRoleId: input.assigned_role_id ?? null,
      title: input.title,
      payload: input.payload ?? '',
      status: input.status ?? 'pending',
      dependsOnJson: JSON.stringify(input.depends_on ?? []),
      result: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return getTask(id)!
}

export function updateTask(
  id: string,
  input: Partial<{ status: TaskStatus; result: string | null; payload: string; assigned_role_id: string | null }>,
): Task | null {
  const values: Partial<TaskRow> = { updatedAt: Date.now() }
  if (input.status !== undefined) values.status = input.status
  if (input.result !== undefined) values.result = input.result
  if (input.payload !== undefined) values.payload = input.payload
  if (input.assigned_role_id !== undefined) values.assignedRoleId = input.assigned_role_id
  getDb().update(tasks).set(values).where(eq(tasks.id, id)).run()
  return getTask(id)
}

export function setTaskDependencies(id: string, dependsOn: string[]): void {
  getDb()
    .update(tasks)
    .set({ dependsOnJson: JSON.stringify(dependsOn), updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .run()
}

export function deleteTasksForSession(sessionId: string): void {
  getDb().delete(tasks).where(eq(tasks.sessionId, sessionId)).run()
}
