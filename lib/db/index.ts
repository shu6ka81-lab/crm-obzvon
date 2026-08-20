import type { PgliteDatabase } from 'drizzle-orm/pglite'
import * as schema from './schema'

/**
 * Одна схема — две среды.
 *  dev  : PGlite (настоящий Postgres в процессе, ставить ничего не нужно)
 *  prod : обычный Postgres по DATABASE_URL
 *
 * SQL и миграции одинаковые, поэтому расхождений между средами нет.
 * Оба драйвера дают одинаковый query-API, поэтому наружу отдаём один тип.
 */
export type DB = PgliteDatabase<typeof schema>

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL

  if (url) {
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const postgres = (await import('postgres')).default
    const client = postgres(url, { max: 10 })
    return drizzle(client, { schema }) as unknown as DB
  }

  const { drizzle } = await import('drizzle-orm/pglite')
  const { PGlite } = await import('@electric-sql/pglite')
  const client = new PGlite(process.env.PGLITE_DIR ?? './.pglite')
  const db = drizzle(client, { schema })

  // В разработке миграции накатываем прямо здесь. PGlite пускает к базе только
  // один процесс, и пока её держит дев-сервер, отдельный запуск миграций
  // просто не откроет базу — а без них страница падает на несуществующей
  // таблице. В проде миграции идут отдельным шагом, до старта приложения:
  // там это осознанный момент, а не побочный эффект первого запроса.
  if (process.env.NODE_ENV !== 'production') {
    const path = await import('node:path')
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') })
  }

  return db
}

// Переживает hot reload в dev — иначе на каждый запрос новый инстанс PGlite.
const globalForDb = globalThis as unknown as { __dbPromise?: Promise<DB> }

export function getDb(): Promise<DB> {
  if (!globalForDb.__dbPromise) globalForDb.__dbPromise = create()
  return globalForDb.__dbPromise
}

export { schema }
