/** Что сейчас в базе: клиенты по источникам и кампании. */
import { sql } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { campaignClients, campaigns, clients } from '../lib/db/schema'

async function main() {
  const db = await getDb()

  const bySource = await db
    .select({
      source: clients.source,
      n: sql<number>`count(*)::int`,
    })
    .from(clients)
    .groupBy(clients.source)
  console.log('КЛИЕНТЫ ПО ИСТОЧНИКАМ')
  bySource.forEach((r) => console.log(`  ${r.source.padEnd(12)} ${r.n}`))

  const camps = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      n: sql<number>`count(${campaignClients.id})::int`,
      sum: sql<number>`coalesce(sum(${campaignClients.presetBudget}),0)::bigint`,
    })
    .from(campaigns)
    .leftJoin(campaignClients, sql`${campaignClients.campaignId} = ${campaigns.id}`)
    .groupBy(campaigns.id, campaigns.name)
    .orderBy(campaigns.id)

  console.log('\nКАМПАНИИ')
  for (const c of camps) {
    const s = Number(c.sum)
    console.log(
      `  #${c.id} ${c.name.padEnd(42)} ${String(c.n).padStart(5)} шт` +
        (s ? `   ${s.toLocaleString('ru-RU')} ₽ за квартал` : ''),
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
