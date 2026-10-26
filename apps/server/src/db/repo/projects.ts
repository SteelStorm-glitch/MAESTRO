import fs from 'node:fs'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import type { Project } from '@maestro/shared'
import { getDb } from '../client'
import { projects, type ProjectRow } from '../schema'
import { newId } from '../../lib/crypto'

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    root_path: row.rootPath,
    created_at: row.createdAt,
  }
}

export function listProjects(): Project[] {
  return getDb().select().from(projects).orderBy(asc(projects.createdAt)).all().map(toProject)
}

export function getProject(id: string): Project | null {
  const row = getDb().select().from(projects).where(eq(projects.id, id)).get()
  return row ? toProject(row) : null
}

export function createProject(input: { name?: string; root_path: string }): Project {
  const root = path.resolve(input.root_path)
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) throw new Error('Project root must be a directory')
  const existing = listProjects().find((p) => p.root_path.toLowerCase() === root.toLowerCase())
  if (existing) return existing
  const id = newId('prj')
  getDb()
    .insert(projects)
    .values({
      id,
      name: input.name?.trim() || path.basename(root),
      rootPath: root,
      createdAt: Date.now(),
    })
    .run()
  return getProject(id)!
}

export function deleteProject(id: string): boolean {
  return getDb().delete(projects).where(eq(projects.id, id)).run().changes > 0
}
