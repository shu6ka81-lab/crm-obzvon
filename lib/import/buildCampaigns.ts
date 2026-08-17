import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { campaignClients, campaigns, clients } from '../db/schema'

/**
 * Стандартные кампании обзвона. Собираются из уже загруженных клиентов
 * по правилам отбора — чтобы после импорта не требовалось лезть в консоль.
 */
const DEFINITIONS = [
  {
    name: 'Крупные разовые (чек от 50 тыс.)',
    description:
      'Купили ровно один раз на сумму от 50 000 ₽ и не вернулись. Самый тёплый сегмент — начинаем с них.',
    where: sql`${clients.shipmentsCount} = 1 and ${clients.totalSum} >= 50000`,
  },
  {
    name: 'Все разовые',
    description: 'Все, у кого ровно одна отгрузка за всё время.',
    where: sql`${clients.shipmentsCount} = 1 and ${clients.totalSum} > 0`,
  },
  {
    name: 'Уходящие (3–12 мес. молчания)',
    description: 'Покупали регулярно, перестали 3–12 месяцев назад. Ещё возвращаемы.',
    where: sql`${clients.totalSum} > 0
               and ${clients.lastOrderDate} is not null
               and ${clients.lastOrderDate} <  current_date - interval '90 days'
               and ${clients.lastOrderDate} >= current_date - interval '365 days'`,
  },
] as const

export interface CampaignSyncResult {
  name: string
  campaignId: number
  added: number
  total: number
}

/**
 * Создаёт недостающие кампании и дозаполняет существующие новыми клиентами.
 * Уже отработанные карточки не трогает — состояние обзвона сохраняется.
 */
export async function syncCampaigns(sourceFile?: string): Promise<CampaignSyncResult[]> {
  const db = await getDb()
  const out: CampaignSyncResult[] = []

  for (const def of DEFINITIONS) {
    let [camp] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.name, def.name))
      .limit(1)

    if (!camp) {
      ;[camp] = await db
        .insert(campaigns)
        .values({ name: def.name, description: def.description, sourceFile })
        .returning({ id: campaigns.id })
    }

    const matching = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(def.where, sql`${clients.deletedAt} is null`))
      .orderBy(desc(clients.totalSum))

    const existing = new Set(
      (
        await db
          .select({ clientId: campaignClients.clientId })
          .from(campaignClients)
          .where(eq(campaignClients.campaignId, camp.id))
      ).map((r) => r.clientId),
    )

    const fresh = matching.filter((c) => !existing.has(c.id))

    const CHUNK = 500
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const rows = fresh.slice(i, i + CHUNK).map((c, k) => ({
        campaignId: camp.id,
        clientId: c.id,
        position: existing.size + i + k,
      }))
      await db.insert(campaignClients).values(rows).onConflictDoNothing()
    }

    out.push({
      name: def.name,
      campaignId: camp.id,
      added: fresh.length,
      total: existing.size + fresh.length,
    })
  }

  return out
}
