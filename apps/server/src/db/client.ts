import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { DB_PATH, ensureHome } from '../lib/paths'
import { logger } from '../lib/logger'
import { migrations } from './migrations'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

let sqlite: Database.Database | null = null
let database: Db | null = null

export function getRawDb(): Database.Database {
  if (!sqlite) throw new Error('Database is not initialised')
  return sqlite
}

export function getDb(): Db {
  if (!database) throw new Error('Database is not initialised')
  return database
}

export function initDatabase(dbPath = DB_PATH): Db {
  if (database) return database
  ensureHome()
  sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  runMigrations(sqlite)
  database = drizzle(sqlite, { schema })
  logger.info(`SQLite ready at ${dbPath}`)
  return database
}

function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((row) => (row as { id: string }).id),
  )
  const insert = db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)')
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    const tx = db.transaction(() => {
      db.exec(migration.sql)
      insert.run(migration.id, Date.now())
    })
    tx()
    logger.info(`Applied migration ${migration.id}`)
  }
}

export function closeDatabase(): void {
  sqlite?.close()
  sqlite = null
  database = null
}
