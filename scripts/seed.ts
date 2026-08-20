/**
 * Разворачивает базу с нуля: миграции, пользователи, импорт выгрузки 1С,
 * сборка кампаний обзвона.
 *
 * Запуск: npm run db:seed [путь\к\выгрузке.xlsx]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { runMigrations } from '../lib/db/migrate'
import { clients, users } from '../lib/db/schema'
import { hashPassword } from '../lib/auth/password'
import { importActivityReport } from '../lib/import/importClients'
import { syncCampaigns } from '../lib/import/buildCampaigns'

const FILE =
  process.argv[2] ?? String.raw`C:\Users\ден\Downloads\Kontragenty_Aktivnost_26.xlsx`

/** Только для локальной разработки — на сервер этот вход не попадает. */
const DEV_LOGIN = 'denis'
const DEV_PASSWORD = 'OfisSluzhba2026!'

async function main() {
  console.log('1. Миграции…')
  await runMigrations()
  const db = await getDb()

  console.log('2. Пользователи…')
  const existingUsers = await db.select({ id: users.id }).from(users)
  if (existingUsers.length === 0) {
    await db.insert(users).values([
      { name: 'Лев', role: 'manager' },
      { name: 'Руководитель', role: 'head' },
    ])
  }

  // Вход для разработки. Без него после пересоздания базы в неё не зайти,
  // и проверки через браузер падают на форме входа — уже наступали.
  // На рабочем сервере пользователи заводятся отдельной командой.
  const [dev] = await db.select({ id: users.id }).from(users).where(eq(users.login, DEV_LOGIN))
  if (!dev) {
    await db.insert(users).values({
      name: 'Денис',
      login: DEV_LOGIN,
      passwordHash: await hashPassword(DEV_PASSWORD),
      role: 'head',
    })
    console.log(`   вход для разработки: ${DEV_LOGIN} / ${DEV_PASSWORD}`)
  }

  console.log(`3. Импорт выгрузки: ${path.basename(FILE)}`)
  const buf = readFileSync(FILE)
  const res = await importActivityReport(buf, path.basename(FILE))
  console.log(
    `   всего ${res.total}, создано ${res.created}, обновлено ${res.updated}, ` +
      `дата отчёта ${res.reportDate}, предупреждений ${res.warnings.length}`,
  )

  console.log('4. Кампании обзвона…')
  // Правила отбора живут в одном месте — иначе сид и рабочий сервер расходятся.
  // Так уже было: сид собирал кампании по прежним правилам, и в них попадали
  // клиенты, которых новые правила туда не берут.
  const built = await syncCampaigns(path.basename(FILE))
  for (const c of built) {
    console.log(`   ${c.name}: ${c.total}`)
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(clients)
  console.log(`\nГотово. Клиентов в базе: ${count}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
