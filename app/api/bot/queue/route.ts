import { NextResponse, type NextRequest } from 'next/server'
import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { campaignClients, campaigns, clients } from '@/lib/db/schema'
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

  const where = [
    isNotNull(clients.phone),
    ne(clients.phone, ''),
    isNull(clients.deletedAt),
    sql`${campaignClients.state} in ('pending', 'in_progress')`,
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
