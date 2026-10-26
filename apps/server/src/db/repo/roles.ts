import { asc, eq } from 'drizzle-orm'
import type { Role, RoleInput } from '@maestro/shared'
import { getDb } from '../client'
import { orchestras, roles, type RoleRow } from '../schema'
import { newId } from '../../lib/crypto'

export function toRole(row: RoleRow): Role {
  let tools: string[] = []
  try {
    tools = JSON.parse(row.toolsJson) as string[]
  } catch {
    tools = []
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    system_prompt: row.systemPrompt,
    model_id: row.modelId,
    temperature: row.temperature,
    tools,
    permission: row.permission as Role['permission'],
    shell_mode: row.shellMode as Role['shell_mode'],
    color: row.color,
    created_at: row.createdAt,
  }
}

export function listRoles(): Role[] {
  return getDb().select().from(roles).orderBy(asc(roles.createdAt)).all().map(toRole)
}

export function getRole(id: string): Role | null {
  const row = getDb().select().from(roles).where(eq(roles.id, id)).get()
  return row ? toRole(row) : null
}

export function createRole(input: RoleInput): Role {
  const id = newId('rol')
  getDb()
    .insert(roles)
    .values({
      id,
      name: input.name,
      description: input.description ?? '',
      systemPrompt: input.system_prompt ?? '',
      modelId: input.model_id ?? null,
      temperature: input.temperature ?? 0.7,
      toolsJson: JSON.stringify(input.tools ?? []),
      permission: input.permission ?? 'write',
      shellMode: input.shell_mode ?? 'off',
      color: input.color ?? '#8B8BF5',
      createdAt: Date.now(),
    })
    .run()
  return getRole(id)!
}

export function updateRole(id: string, input: Partial<RoleInput>): Role | null {
  const existing = getRole(id)
  if (!existing) return null
  const values: Partial<RoleRow> = {}
  if (input.name !== undefined) values.name = input.name
  if (input.description !== undefined) values.description = input.description
  if (input.system_prompt !== undefined) values.systemPrompt = input.system_prompt
  if (input.model_id !== undefined) values.modelId = input.model_id
  if (input.temperature !== undefined) values.temperature = input.temperature
  if (input.tools !== undefined) values.toolsJson = JSON.stringify(input.tools)
  if (input.permission !== undefined) values.permission = input.permission
  if (input.shell_mode !== undefined) values.shellMode = input.shell_mode
  if (input.color !== undefined) values.color = input.color
  getDb().update(roles).set(values).where(eq(roles.id, id)).run()
  return getRole(id)
}

export function deleteRole(id: string): boolean {
  const db = getDb()
  // Orchestra slots have no FK constraints — clear dangling references before deleting the role.
  db.update(orchestras).set({ conductorRoleId: null }).where(eq(orchestras.conductorRoleId, id)).run()
  db.update(orchestras).set({ verifierRoleId: null }).where(eq(orchestras.verifierRoleId, id)).run()
  db.update(orchestras).set({ fixerRoleId: null }).where(eq(orchestras.fixerRoleId, id)).run()
  return db.delete(roles).where(eq(roles.id, id)).run().changes > 0
}
