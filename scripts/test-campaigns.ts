/**
 * Проверяет, что кампании обзвона не пересекаются.
 *
 * Одна компания в двух списках означает два звонка одному человеку: второй
 * звонок портит впечатление от первого. Проверка написана после того, как
 * в рабочей базе нашлись 372 такие компании.
 *
 * Запуск: npx tsx scripts/test-campaigns.ts
 */
import { alias } from 'drizzle-orm/pg-core'
import { lt, eq, sql } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { campaignClients, campaigns } from '../lib/db/schema'
import { syncCampaigns } from '../lib/import/buildCampaigns'

async function main() {
  const db = await getDb()

  const res = await syncCampaigns('проверка')
  console.log('Кампании после пересборки:\n')
  for (const r of res) {
    console.log(`  ${String(r.total).padStart(6)}  ${r.name}${r.added ? `  (+${r.added})` : ''}`)
  }

  // Полный список, включая списки конкурентов — их syncCampaigns не создаёт
  const all = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      count: sql<number>`count(${campaignClients.id})::int`,
    })
    .from(campaigns)
    .leftJoin(campaignClients, eq(campaignClients.campaignId, campaigns.id))
    .groupBy(campaigns.id, campaigns.name)
    .orderBy(campaigns.id)

  console.log('\nВсе кампании в базе:\n')
  let sum = 0
  for (const c of all) {
    sum += c.count
    console.log(`  ${String(c.count).padStart(6)}  ${c.name}`)
  }

  const b = alias(campaignClients, 'b')
  const overlaps = await db
    .select({
      a: campaignClients.campaignId,
      b: b.campaignId,
      общих: sql<number>`count(*)::int`,
    })
    .from(campaignClients)
    .innerJoin(
      b,
      sql`${b.clientId} = ${campaignClients.clientId} and ${lt(campaignClients.campaignId, b.campaignId)}`,
    )
    .groupBy(campaignClients.campaignId, b.campaignId)

  console.log('\nПересечения:')
  if (overlaps.length === 0) {
    console.log('  нет — каждая компания ровно в одном списке')
  } else {
    for (const o of overlaps) console.log(`  кампании ${o.a} и ${o.b}: ${o.общих}`)
    throw new Error('кампании пересекаются')
  }

  const [{ distinct }] = await db
    .select({ distinct: sql<number>`count(distinct ${campaignClients.clientId})::int` })
    .from(campaignClients)

  console.log(`\nСтрок в очередях: ${sum}, разных компаний: ${distinct}`)
  if (sum !== distinct) throw new Error('строк больше, чем компаний — где-то дубль')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
