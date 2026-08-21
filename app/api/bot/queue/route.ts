import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { callRequests, campaignClients, campaigns, clients, settings } from '@/lib/db/schema'
import { BOT_SEEN_KEY } from '@/lib/botStatus'
import { checkBotToken } from '@/lib/botAuth'
import { stageLabel, type CampaignKind, type Stage } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

/**
 * Очередь для голосового робота: кому звонить дальше.
 *
 * Отдаём не голый номер, а то, что роботу нужно сказать по делу: как компания
 * называется, сколько и когда у нас покупала, что за очередь и на какой она
 * стадии. Возврат ушедшего клиента — не холодный звонок, и разговор начинается
 * не с «здравствуйте, мы поставщик», а с «вы у нас покупали до марта».
 *
 * Без телефона в очередь не попадают: звонить некуда, и молча отдавать такую
 * строку роботу — значит получить назад пустой результат и потерянное время.
 */
export async function GET(req: NextRequest) {
  const auth = checkBotToken(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const campaignId = Number(url.searchParams.get('campaign'))
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 100)

  const db = await getDb()

  /*
   * Заявка забирается только тем, кто и правда собирается звонить: claim=1.
   *
   * Раньше её помечал «в работе» любой запрос очереди — в том числе
   * просмотр и проверка связи. Человек нажимал «Позвонить», заявка тут же
   * уходила в никуда, и кнопка отвечала «уже в очереди», хотя звонить
   * её никто не собирался.
   */
  const claim = url.searchParams.get('claim') === '1'

  // Отмечаемся, что робот на связи: система должна уметь ответить, почему
  // ничего не происходит, — «робот не запущен» или «звонит прямо сейчас».
  await db
    .insert(settings)
    .values({ key: BOT_SEEN_KEY, value: new Date().toISOString(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: new Date().toISOString(), updatedAt: new Date() },
    })

  // Зависшие возвращаем в работу. Робот мог упасть посреди разговора, и
  // заявка осталась бы в «звоним» навсегда — с виду работа идёт, на деле
  // не происходит ничего.
  await db
    .update(callRequests)
    .set({ state: 'waiting', takenAt: null })
    .where(
      and(
        eq(callRequests.state, 'calling'),
        sql`${callRequests.takenAt} < now() - interval '15 minutes'`,
      ),
    )

  const requested = await db
    .select({
      requestId: callRequests.id,
      clientId: callRequests.clientId,
      campaignId: callRequests.campaignId,
      linkId: callRequests.campaignClientId,
      phone: callRequests.phone,
      note: callRequests.note,
      campaignName: campaigns.name,
      campaignKind: campaigns.kind,
      stage: campaignClients.stage,
      presetSupplier: campaignClients.presetSupplier,
      presetBudget: campaignClients.presetBudget,
      name: clients.name,
      contactPerson: clients.contactPerson,
      inn: clients.inn,
      totalSum: clients.totalSum,
      shipmentsCount: clients.shipmentsCount,
      avgCheck: clients.avgCheck,
      lastOrderDate: clients.lastOrderDate,
      manager1c: clients.manager1c,
    })
    .from(callRequests)
    .innerJoin(clients, eq(clients.id, callRequests.clientId))
    // Обвязка кампании нужна роботу для первой фразы: возврат ушедшего
    // клиента и холодный звонок начинаются по-разному. Соединение внешнее —
    // позвонить можно и тому, кто ни в одной очереди не стоит.
    .leftJoin(campaignClients, eq(campaignClients.id, callRequests.campaignClientId))
    .leftJoin(campaigns, eq(campaigns.id, callRequests.campaignId))
    .where(eq(callRequests.state, 'waiting'))
    .orderBy(asc(callRequests.createdAt))
    .limit(limit)

  if (claim && requested.length > 0) {
    await db
      .update(callRequests)
      .set({ state: 'calling', takenAt: new Date() })
      .where(
        inArray(
          callRequests.id,
          requested.map((r) => r.requestId),
        ),
      )
  }

  const where = [
    isNotNull(clients.phone),
    ne(clients.phone, ''),
    isNull(clients.deletedAt),
    sql`${campaignClients.state} in ('pending', 'in_progress')`,
    /*
     * Кто уже стоит отдельной заявкой — в общую очередь не попадает.
     * Иначе один и тот же человек уезжает роботу дважды за прогон:
     * заявкой и просто по списку, и получает два звонка подряд.
     */
    sql`not exists (
      select 1 from ${callRequests} cr
      where cr.client_id = ${clients.id}
        and cr.state in ('waiting', 'calling')
    )`,
  ]
  if (Number.isInteger(campaignId) && campaignId > 0) {
    where.push(eq(campaignClients.campaignId, campaignId))
  }

  const rows = await db
    .select({
      linkId: campaignClients.id,
      clientId: clients.id,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignKind: campaigns.kind,
      stage: campaignClients.stage,
      name: clients.name,
      phone: clients.phone,
      contactPerson: clients.contactPerson,
      inn: clients.inn,
      totalSum: clients.totalSum,
      shipmentsCount: clients.shipmentsCount,
      avgCheck: clients.avgCheck,
      lastOrderDate: clients.lastOrderDate,
      manager1c: clients.manager1c,
      presetSupplier: campaignClients.presetSupplier,
      presetBudget: campaignClients.presetBudget,
    })
    .from(campaignClients)
    .innerJoin(clients, eq(clients.id, campaignClients.clientId))
    .innerJoin(campaigns, eq(campaigns.id, campaignClients.campaignId))
    .where(and(...where))
    .orderBy(asc(campaignClients.position))
    .limit(limit)

  // Сколько всего в очереди и у скольких есть телефон. Нужно, чтобы на той
  // стороне было видно причину пустого ответа: список кончился или звонить
  // некуда. Разница между этими двумя случаями — целый рабочий день.
  const [counts] = await db
    .select({
      всего: sql<number>`count(*)::int`,
      сТелефоном: sql<number>`count(*) filter (
        where ${clients.phone} is not null and ${clients.phone} <> ''
      )::int`,
    })
    .from(campaignClients)
    .innerJoin(clients, eq(clients.id, campaignClients.clientId))
    .where(
      Number.isInteger(campaignId) && campaignId > 0
        ? eq(campaignClients.campaignId, campaignId)
        : sql`true`,
    )

  return NextResponse.json({
    // Заявки руками — вперёд очереди: человек ждёт этот звонок сейчас
    requests: requested.map((r) => ({
      requestId: r.requestId,
      clientId: r.clientId,
      campaignId: r.campaignId,
      linkId: r.linkId,
      name: r.name,
      phone: r.phone,
      contact: r.contactPerson,
      inn: r.inn,
      note: r.note,
      campaign: r.campaignName,
      kind: r.campaignKind ?? 'acquisition',
      stage: r.stage,
      stageLabel: r.stage
        ? stageLabel(r.stage as Stage, (r.campaignKind ?? 'acquisition') as CampaignKind)
        : null,
      byRequest: true,
      competitor:
        r.presetSupplier || r.presetBudget
          ? { supplier: r.presetSupplier, quarterBudget: Number(r.presetBudget ?? 0) }
          : null,
      history: {
        totalSum: Number(r.totalSum),
        shipments: Number(r.shipmentsCount),
        avgCheck: Number(r.avgCheck),
        lastOrderDate: r.lastOrderDate ? String(r.lastOrderDate) : null,
        manager: r.manager1c,
      },
    })),
    leads: rows.map((r) => ({
      linkId: r.linkId,
      clientId: r.clientId,
      campaignId: r.campaignId,
      campaign: r.campaignName,
      kind: r.campaignKind,
      stage: r.stage,
      stageLabel: stageLabel(r.stage as Stage, r.campaignKind as CampaignKind),
      name: r.name,
      phone: r.phone,
      contact: r.contactPerson,
      inn: r.inn,
      history: {
        totalSum: Number(r.totalSum),
        shipments: Number(r.shipmentsCount),
        avgCheck: Number(r.avgCheck),
        lastOrderDate: r.lastOrderDate ? String(r.lastOrderDate) : null,
        manager: r.manager1c,
      },
      competitor:
        r.presetSupplier || r.presetBudget
          ? { supplier: r.presetSupplier, quarterBudget: Number(r.presetBudget ?? 0) }
          : null,
    })),
    counts: {
      inCampaign: Number(counts?.всего ?? 0),
      withPhone: Number(counts?.сТелефоном ?? 0),
    },
  })
}
