import path from 'node:path'
import { getDb } from './index'

const MIGRATIONS = path.join(process.cwd(), 'drizzle')

/**
 * Накатывает миграции на ту базу, которая сейчас активна.
 * В dev это PGlite, в проде — Postgres по DATABASE_URL.
 */
export async function runMigrations() {
  const db = await getDb()

  if (process.env.DATABASE_URL) {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS })
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS })
  }
}
