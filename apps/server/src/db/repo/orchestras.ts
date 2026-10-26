import { asc, eq } from 'drizzle-orm'
import type { Orchestra, OrchestraInput, OrchestraStrategy } from '@maestro/shared'
import { getDb, getRawDb } from '../client'
import { orchestraMembers, orchestras, type OrchestraRow } from '../schema'
import { newId } from '../../lib/crypto'

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function listOrchestras(): Orchestra[] {
  const rows = getDb().select().from(orchestras).orderBy(asc(orchestras.createdAt)).all()
  return rows.map((row) => hydrate(row))
}

export function getOrchestra(id: string): Orchestra | null {
  const row = getDb().select().from(orchestras).where(eq(orchestras.id, id)).get()
  return row ? hydrate(row) : null
}

function hydrate(row: OrchestraRow): Orchestra {
  const members = getDb()
    .select()
    .from(orchestraMembers)
    .where(eq(orchestraMembers.orchestraId, row.id))
    .orderBy(asc(orchestraMembers.position))
    .all()
  return {
    id: row.id,
    name: row.name,
    strategy: row.strategy as OrchestraStrategy,
    conductor_role_id: row.conductorRoleId,
    verifier_role_id: row.verifierRoleId,
    fixer_role_id: row.fixerRoleId,
    max_rounds: row.maxRounds,
    budget_tokens: row.budgetTokens,
    approval_mode: row.approvalMode as Orchestra['approval_mode'],
    config_json: parseConfig(row.configJson),
    created_at: row.createdAt,
    members: members.map((m) => ({ orchestra_id: m.orchestraId, role_id: m.roleId, position: m.position })),
  }
}

export function createOrchestra(input: OrchestraInput): Orchestra {
  const id = newId('orc')
  const db = getDb()
  db.insert(orchestras)
    .values({
      id,
      name: input.name,
      strategy: input.strategy ?? 'conductor',
      conductorRoleId: input.conductor_role_id ?? null,
      verifierRoleId: input.verifier_role_id ?? null,
      fixerRoleId: input.fixer_role_id ?? null,
      maxRounds: input.max_rounds ?? 6,
      budgetTokens: input.budget_tokens ?? 500000,
      approvalMode: input.approval_mode ?? 'auto',
      configJson: JSON.stringify(input.config_json ?? {}),
      createdAt: Date.now(),
    })
    .run()
  replaceMembers(id, input.members ?? [])
  return getOrchestra(id)!
}

export function updateOrchestra(id: string, input: Partial<OrchestraInput>): Orchestra | null {
  const existing = getOrchestra(id)
  if (!existing) return null
  const values: Partial<OrchestraRow> = {}
  if (input.name !== undefined) values.name = input.name
  if (input.strategy !== undefined) values.strategy = input.strategy
  if (input.conductor_role_id !== undefined) values.conductorRoleId = input.conductor_role_id
  if (input.verifier_role_id !== undefined) values.verifierRoleId = input.verifier_role_id
  if (input.fixer_role_id !== undefined) values.fixerRoleId = input.fixer_role_id
  if (input.max_rounds !== undefined) values.maxRounds = input.max_rounds
  if (input.budget_tokens !== undefined) values.budgetTokens = input.budget_tokens
  if (input.approval_mode !== undefined) values.approvalMode = input.approval_mode
  if (input.config_json !== undefined) values.configJson = JSON.stringify(input.config_json)
  if (Object.keys(values).length > 0) {
    getDb().update(orchestras).set(values).where(eq(orchestras.id, id)).run()
  }
  if (input.members !== undefined) replaceMembers(id, input.members)
  return getOrchestra(id)
}

export function replaceMembers(orchestraId: string, members: Array<{ role_id: string; position: number }>): void {
  const db = getRawDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM orchestra_members WHERE orchestra_id = ?').run(orchestraId)
    const insert = db.prepare(
      'INSERT OR IGNORE INTO orchestra_members (orchestra_id, role_id, position) VALUES (?, ?, ?)',
    )
    members.forEach((member, index) => insert.run(orchestraId, member.role_id, member.position ?? index))
  })
  tx()
}

export function deleteOrchestra(id: string): boolean {
  return getDb().delete(orchestras).where(eq(orchestras.id, id)).run().changes > 0
}
