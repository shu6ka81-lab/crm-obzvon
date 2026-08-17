/**
 * Разворачивает базу с нуля: миграции, пользователи, импорт выгрузки 1С,
 * сборка кампаний обзвона.
 *
 * Запуск: npm run db:seed [путь\к\выгрузке.xlsx]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { runMigrations } from '../lib/db/migrate'
import { users, clients, campaigns } from '../lib/db/schema'
import { importActivityReport, buildCampaignFromIds } from '../lib/import/importClients'

const FILE =
  process.argv[2] ?? String.raw`C:\Users\ден\Downloads\Kontragenty_Aktivnost_26.xlsx`

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

  console.log(`3. Импорт выгрузки: ${path.basename(FILE)}`)
  const buf = readFileSync(FILE)
  const res = await importActivityReport(buf, path.basename(FILE))
  console.log(
    `   всего ${res.total}, создано ${res.created}, обновлено ${res.updated}, ` +
      `дата отчёта ${res.reportDate}, предупреждений ${res.warnings.length}`,
  )

  console.log('4. Кампании обзвона…')
  const already = await db.select({ id: campaigns.id }).from(campaigns)
  if (already.length > 0) {
    console.log('   кампании уже созданы, пропускаю')
  } else {
    // Разовые покупатели: ровно одна отгрузка, есть сумма
    const singles = await db
      .select({ id: clients.id, totalSum: clients.totalSum })
      .from(clients)
      .where(and(eq(clients.shipmentsCount, 1), sql`${clients.totalSum} > 0`))
      .orderBy(desc(clients.totalSum))

    const big = singles.filter((c) => c.totalSum >= 50_000)

    const a = await buildCampaignFromIds({
      name: 'Крупные разовые (чек от 50 тыс.)',
      description:
        'Купили ровно один раз на сумму от 50 000 ₽ и не вернулись. Самый тёплый сегмент — начинаем с них.',
      sourceFile: path.basename(FILE),
      clientIds: big.map((c) => c.id),
    })
    console.log(`   «Крупные разовые»: ${a.count}`)

    const b = await buildCampaignFromIds({
      name: 'Все разовые',
      description: 'Все, у кого ровно одна отгрузка за всё время.',
      sourceFile: path.basename(FILE),
      clientIds: singles.map((c) => c.id),
    })
    console.log(`   «Все разовые»: ${b.count}`)

    // Уходящие: молчат 3–12 месяцев, но покупали регулярно
    const fading = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        sql`${clients.totalSum} > 0
            and ${clients.lastOrderDate} is not null
            and ${clients.lastOrderDate} < current_date - interval '90 days'
            and ${clients.lastOrderDate} >= current_date - interval '365 days'`,
      )
      .orderBy(desc(clients.totalSum))

    const c = await buildCampaignFromIds({
      name: 'Уходящие (3–12 мес. молчания)',
      description:
        'Покупали регулярно, перестали 3–12 месяцев назад. Ещё возвращаемы.',
      sourceFile: path.basename(FILE),
      clientIds: fading.map((x) => x.id),
    })
    console.log(`   «Уходящие»: ${c.count}`)
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
