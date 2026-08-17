import { and, asc, desc, eq, isNull, or, sql, count } from 'drizzle-orm'
import { getDb } from './db'
import {
  campaignClients,
  campaigns,
  clients,
  qualifications,
  tasks,
  touches,
  users,
} from './db/schema'

export const SEGMENT_LABEL: Record<string, string> = {
  active: 'Активный',
  d61: 'Молчит 61 день',
  d91: 'Молчит 91 день',
  d121: 'Молчит 121 день',
  inactive: 'Не активный',
  new: 'Новый, покупок не было',
  unknown: '—',
}

export const QUALIFIED_LABEL: Record<string, string> = {
  yes: 'да, наш клиент',
  thinking: 'думает',
  no: 'нет, не интересен',
}

export const CLIENT_TYPE_LABEL: Record<string, string> = {
  legal: 'юрлицо',
  individual: 'физлицо',
  intercity: 'межгород',
  unknown: 'не определён',
}

export const OUTCOME_LABEL: Record<string, string> = {
  reached: 'Дозвонился',
  no_answer: 'Не взяли',
  busy: 'Занято',
  wrong_number: 'Номер не тот',
  callback: 'Просили перезвонить',
  refused: 'Отказ',
}

export async function listCampaigns() {
  const db = await getDb()
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      description: campaigns.description,
      total: count(campaignClients.id),
      done: sql<number>`count(*) filter (where ${campaignClients.state} = 'done')::int`,
      pending: sql<number>`count(*) filter (where ${campaignClients.state} = 'pending')::int`,
      /** Сколько эти компании купили у нас за всё время. */
      sumOwn: sql<number>`coalesce(sum(${clients.totalSum}), 0)::bigint`,
      /** Сколько они закупают на стороне за квартал — для списков конкурентов. */
      sumPreset: sql<number>`coalesce(sum(${campaignClients.presetBudget}), 0)::bigint`,
    })
    .from(campaigns)
    .leftJoin(campaignClients, eq(campaignClients.campaignId, campaigns.id))
    .leftJoin(clients, eq(clients.id, campaignClients.clientId))
    .where(eq(campaigns.isActive, true))
    .groupBy(campaigns.id)
    .orderBy(asc(campaigns.id))
}

export async function getCampaign(campaignId: number) {
  const db = await getDb()
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  return row ?? null
}

/** Следующий в очереди: сначала отложенные с наступившим сроком, потом новые. */
export async function getNextInCampaign(campaignId: number) {
  const db = await getDb()
  const [row] = await db
    .select({
      linkId: campaignClients.id,
      position: campaignClients.position,
      state: campaignClients.state,
      presetBudget: campaignClients.presetBudget,
      presetSupplier: campaignClients.presetSupplier,
      presetPurchases: campaignClients.presetPurchases,
      presetNote: campaignClients.presetNote,
      client: clients,
    })
    .from(campaignClients)
    .innerJoin(clients, eq(clients.id, campaignClients.clientId))
    .where(
      and(
        eq(campaignClients.campaignId, campaignId),
        sql`${campaignClients.state} in ('pending', 'in_progress')`,
        isNull(clients.deletedAt),
      ),
    )
    .orderBy(asc(campaignClients.position))
    .limit(1)
  return row ?? null
}

/** Конкретный клиент кампании — когда позвонить хотят не по очереди. */
export async function getCampaignClient(campaignId: number, clientId: number) {
  const db = await getDb()
  const [row] = await db
    .select({
      linkId: campaignClients.id,
      position: campaignClients.position,
      state: campaignClients.state,
      presetBudget: campaignClients.presetBudget,
      presetSupplier: campaignClients.presetSupplier,
      presetPurchases: campaignClients.presetPurchases,
      presetNote: campaignClients.presetNote,
      client: clients,
    })
    .from(campaignClients)
    .innerJoin(clients, eq(clients.id, campaignClients.clientId))
    .where(
      and(eq(campaignClients.campaignId, campaignId), eq(campaignClients.clientId, clientId)),
    )
    .limit(1)
  return row ?? null
}

/** Весь список кампании — чтобы видеть, кто впереди, и выбрать вручную. */
export async function listCampaignClients(campaignId: number) {
  const db = await getDb()
  return db
    .select({
      clientId: clients.id,
      code1c: clients.code1c,
      key: clientKeySql,
      inn: clients.inn,
      source: clients.source,
      presetBudget: campaignClients.presetBudget,
      presetSupplier: campaignClients.presetSupplier,
      presetPurchases: campaignClients.presetPurchases,
      presetNote: campaignClients.presetNote,
      name: clients.name,
      totalSum: clients.totalSum,
      lastOrderDate: clients.lastOrderDate,
      manager1c: clients.manager1c,
      state: campaignClients.state,
      position: campaignClients.position,
      touchCount: sql<number>`(
        select count(*)::int from ${touches}
        where ${touches.clientId} = ${clients.id}
          and ${touches.campaignId} = ${campaignId}
      )`,
      lastOutcome: sql<string | null>`(
        select ${touches.outcome} from ${touches}
        where ${touches.clientId} = ${clients.id}
          and ${touches.campaignId} = ${campaignId}
        order by ${touches.happenedAt} desc limit 1
      )`,
    })
    .from(campaignClients)
    .innerJoin(clients, eq(clients.id, campaignClients.clientId))
    .where(eq(campaignClients.campaignId, campaignId))
    .orderBy(asc(campaignClients.position))
}

export async function getClientById(clientId: number) {
  const db = await getDb()
  const [row] = await db.select().from(clients).where(eq(clients.id, clientId))
  return row ?? null
}

/**
 * Ключ клиента для ссылок: код 1С, если он есть, иначе ИНН, иначе id.
 * У компаний из книг продаж конкурентов кода 1С нет.
 */
export const clientKeySql = sql<string>`coalesce(${clients.code1c}, ${clients.inn}, ${clients.id}::text)`

export function clientKey(c: {
  code1c?: string | null
  inn?: string | null
  id: number
}): string {
  return c.code1c ?? c.inn ?? String(c.id)
}

export async function getClientByKey(key: string) {
  const db = await getDb()
  const asId = Number(key)
  const [row] = await db
    .select()
    .from(clients)
    .where(
      or(
        eq(clients.code1c, key),
        eq(clients.inn, key),
        Number.isInteger(asId) && asId > 0 ? eq(clients.id, asId) : undefined,
      ),
    )
    .limit(1)
  return row ?? null
}

export async function getTouches(clientId: number) {
  const db = await getDb()
  return db
    .select({
      id: touches.id,
      happenedAt: touches.happenedAt,
      channel: touches.channel,
      outcome: touches.outcome,
      note: touches.note,
      gotQuoteRequest: touches.gotQuoteRequest,
      userName: users.name,
    })
    .from(touches)
    .leftJoin(users, eq(users.id, touches.userId))
    .where(eq(touches.clientId, clientId))
    .orderBy(desc(touches.happenedAt))
}

/** Актуальная квалификация — последняя по времени запись. */
export async function getLatestQualification(clientId: number) {
  const db = await getDb()
  const [row] = await db
    .select()
    .from(qualifications)
    .where(eq(qualifications.clientId, clientId))
    .orderBy(desc(qualifications.createdAt))
    .limit(1)
  return row ?? null
}

export async function getOpenTasks(clientId?: number) {
  const db = await getDb()
  const where = clientId
    ? and(eq(tasks.status, 'open'), eq(tasks.clientId, clientId))
    : eq(tasks.status, 'open')

  return db
    .select({
      id: tasks.id,
      dueDate: tasks.dueDate,
      title: tasks.title,
      clientId: tasks.clientId,
      clientName: clients.name,
      clientKey: clientKeySql,
      assignee: users.name,
    })
    .from(tasks)
    .innerJoin(clients, eq(clients.id, tasks.clientId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(where)
    .orderBy(asc(tasks.dueDate))
}

export interface Funnel {
  inList: number
  called: number
  reached: number
  qualified: number
  quoteRequests: number
}

export async function getFunnel(campaignId: number): Promise<Funnel> {
  const db = await getDb()

  const [list] = await db
    .select({ n: count() })
    .from(campaignClients)
    .where(eq(campaignClients.campaignId, campaignId))

  const [calls] = await db
    .select({
      called: sql<number>`count(distinct ${touches.clientId})::int`,
      reached: sql<number>`count(distinct ${touches.clientId}) filter (where ${touches.outcome} = 'reached')::int`,
      quotes: sql<number>`count(distinct ${touches.clientId}) filter (where ${touches.gotQuoteRequest})::int`,
    })
    .from(touches)
    .where(eq(touches.campaignId, campaignId))

  const [qual] = await db
    .select({ n: sql<number>`count(distinct ${qualifications.clientId})::int` })
    .from(qualifications)
    .innerJoin(campaignClients, eq(campaignClients.clientId, qualifications.clientId))
    .where(and(eq(campaignClients.campaignId, campaignId), eq(qualifications.isQualified, 'yes')))

  return {
    inList: Number(list?.n ?? 0),
    called: Number(calls?.called ?? 0),
    reached: Number(calls?.reached ?? 0),
    qualified: Number(qual?.n ?? 0),
    quoteRequests: Number(calls?.quotes ?? 0),
  }
}

export async function listUsers() {
  const db = await getDb()
  return db.select().from(users).where(eq(users.isActive, true)).orderBy(asc(users.id))
}
