import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { campaignClients, campaigns, clients, touches } from '../db/schema'

/**
 * Стандартные кампании обзвона. Собираются из уже загруженных клиентов
 * по правилам отбора — чтобы после импорта не требовалось лезть в консоль.
 *
 * Порядок в списке — это приоритет. Клиент попадает только в первую подходящую
 * кампанию: одна компания в двух списках означает два звонка одному и тому же
 * человеку, а второй звонок портит впечатление от первого.
 *
 * Сами условия при этом сделаны непересекающимися, и приоритет тут страховка,
 * а не механизм. Раньше «Уходящие» описывались как «покупали регулярно,
 * перестали», но регулярность в отборе не проверялась — и туда падали разовые
 * покупатели. 372 компании оказались сразу в двух списках. Поэтому «одна
 * отгрузка» и «больше одной» теперь разведены явно.
 */
const DEFINITIONS = [
  {
    name: 'Крупные разовые (чек от 50 тыс.)',
    description:
      'Купили ровно один раз на сумму от 50 000 ₽ и не вернулись. Самый тёплый сегмент — начинаем с них.',
    where: sql`${clients.shipmentsCount} = 1 and ${clients.totalSum} >= 50000`,
  },
  {
    name: 'Уходящие (3–12 мес. молчания)',
    description:
      'Покупали не один раз и перестали 3–12 месяцев назад. Ещё помнят компанию — возвращаются легче всех.',
    where: sql`${clients.shipmentsCount} > 1
               and ${clients.lastOrderDate} is not null
               and ${clients.lastOrderDate} <  current_date - interval '90 days'
               and ${clients.lastOrderDate} >= current_date - interval '365 days'`,
  },
  {
    /**
     * Отсечка по сумме не произвольная. Среди ушедших больше года назад
     * 1305 компаний с чеком от 30 тысяч дают 245 млн, а хвост из 3091 компании —
     * 33 млн. Звонить хвосту дороже, чем он приносит.
     */
    name: 'Давно ушедшие (больше года, чек от 30 тыс.)',
    description:
      'Покупали не один раз, но замолчали больше года назад. Крупные — те, ради кого стоит поднять трубку.',
    where: sql`${clients.shipmentsCount} > 1
               and ${clients.lastOrderDate} is not null
               and ${clients.lastOrderDate} < current_date - interval '365 days'
               and ${clients.totalSum} >= 30000`,
  },
  {
    name: 'Все разовые',
    description: 'Остальные, у кого ровно одна отгрузка за всё время.',
    where: sql`${clients.shipmentsCount} = 1 and ${clients.totalSum} > 0`,
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

  // Кого уже забрала кампания повыше приоритетом — в следующие не берём.
  const claimed = new Set<number>()

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

    // Убираем тех, кто правилу больше не отвечает. Сборка умела только
    // добавлять, и при уточнении правила в кампании оставались случайные люди:
    // разовые покупатели годами числились «уходящими» — по прежнему условию,
    // где регулярность покупок не проверялась.
    await db.execute(sql`
      delete from ${campaignClients}
      where ${campaignClients.campaignId} = ${camp.id}
        and ${campaignClients.state} = 'pending'
        and ${campaignClients.clientId} not in (
          select ${clients.id} from ${clients}
          where ${def.where} and ${clients.deletedAt} is null
        )
        and not exists (
          select 1 from ${touches}
          where ${touches.clientId} = ${campaignClients.clientId}
            and ${touches.campaignId} = ${campaignClients.campaignId}
        )
    `)

    const matchingAll = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(def.where, sql`${clients.deletedAt} is null`))
      .orderBy(desc(clients.totalSum))

    const matching = matchingAll.filter((c) => !claimed.has(c.id))
    matching.forEach((c) => claimed.add(c.id))

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

  await dropDuplicates(out.map((r) => r.campaignId))

  // Пересчитываем итоги после чистки. Иначе на странице импорта показывается
  // число, которое было верно секунду назад и уже не соответствует спискам.
  const counts = await db
    .select({
      campaignId: campaignClients.campaignId,
      n: sql<number>`count(*)::int`,
    })
    .from(campaignClients)
    .groupBy(campaignClients.campaignId)
  const byId = new Map(counts.map((c) => [c.campaignId, c.n]))
  for (const r of out) r.total = byId.get(r.campaignId) ?? 0

  return out
}

/**
 * Убирает клиентов из кампаний пониже приоритетом, если они попали туда
 * прежними правилами отбора. Порядок приоритета — порядок массива, а всё
 * остальное — списки конкурентов — идёт следом в порядке появления.
 *
 * Списки конкурентов тоже пересекаются между собой: часть компаний закупается
 * сразу у обоих. Для понимания рынка это ценный факт, но для очереди звонков —
 * такой же дубль, поэтому в обзвон компания попадает один раз. Сам факт закупки
 * у нескольких поставщиков сохраняется в карточке.
 *
 * Трогаем только нетронутые карточки: если по клиенту уже звонили или двигали
 * его по воронке, запись остаётся. Потерять историю работы хуже, чем оставить
 * дубль, — дубль видно глазами, а пропавший разговор восстановить нечем.
 */
async function dropDuplicates(idsByPriority: number[]): Promise<number> {
  const db = await getDb()

  const all = await db.select({ id: campaigns.id }).from(campaigns).orderBy(campaigns.id)
  const rest = all.map((c) => c.id).filter((id) => !idsByPriority.includes(id))
  const order = [...idsByPriority, ...rest]
  if (order.length < 2) return 0

  const ranks = order.map((id, i) => `(${id}, ${i})`).join(', ')
  const res = await db.execute(
    sql.raw(`
      delete from campaign_clients cc
      using (
        select cc2.id,
               row_number() over (partition by cc2.client_id order by p.rank) as rn
        from campaign_clients cc2
        join (values ${ranks}) as p(campaign_id, rank) on p.campaign_id = cc2.campaign_id
      ) d
      where d.id = cc.id
        and d.rn > 1
        and cc.state = 'pending'
        and not exists (
          select 1 from touches t
          where t.client_id = cc.client_id and t.campaign_id = cc.campaign_id
        )
    `),
  )
  return (res as unknown as { rowCount?: number }).rowCount ?? 0
}
