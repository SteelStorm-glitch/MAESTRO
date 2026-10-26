import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { settings } from '../schema'

export function getAllSettings(): Record<string, unknown> {
  const rows = getDb().select().from(settings).all()
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value)
    } catch {
      out[row.key] = row.value
    }
  }
  return out
}

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get()
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  const db = getDb()
  const existing = db.select().from(settings).where(eq(settings.key, key)).get()
  if (existing) db.update(settings).set({ value: raw }).where(eq(settings.key, key)).run()
  else db.insert(settings).values({ key, value: raw }).run()
}

export function setSettings(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) setSetting(key, value)
}
