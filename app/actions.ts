'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { recordTouch } from '@/lib/touch'
import { getClientCampaignLink, listCampaignClients } from '@/lib/queries'
import { callRequests, campaignClients, clients, stageChanges, tasks, users } from '@/lib/db/schema'

const TouchSchema = z.object({
  /**
   * Кампании может не быть: с карточки клиента звонят и тем, кто ни в одной
   * очереди не стоит. Тогда касание пишется просто клиенту, без движения
   * по очереди — иначе такую работу вообще некуда записать.
   */
  campaignId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive(),
  linkId: z.coerce.number().int().positive().optional(),

  outcome: z.enum(['reached', 'no_answer', 'busy', 'wrong_number', 'callback', 'refused']),
  note: z.string().trim().max(4000).optional(),
  gotQuoteRequest: z.coerce.boolean().optional(),

  contactPosition: z.string().trim().max(200).optional(),
  peopleServed: z.string().optional(),
  monthlyBudget: z.string().optional(),
  otherSuppliers: z.string().trim().max(500).optional(),
  clientType: z.enum(['legal', 'individual', 'intercity', 'unknown']).optional(),
  isQualified: z.enum(['yes', 'no', 'thinking']).optional(),
  rejectReason: z.string().trim().max(500).optional(),

  nextStepDate: z.string().optional(),
  nextStepTitle: z.string().trim().max(300).optional(),

  stage: z
    .enum(['lead', 'contacted', 'audit', 'quote', 'decision', 'won', 'lost'])
    .optional(),
  currentStage: z
    .enum(['lead', 'contacted', 'audit', 'quote', 'decision', 'won', 'lost'])
    .optional(),
  /** Пусто — стадию выберет сервер по итогу звонка. */
  stageTouched: z.string().optional(),
})

/**
 * Незаполненные поля формы приходят пустой строкой, а необязательные
 * перечисления её не принимают — и вся форма молча не сохраняется.
 * Поэтому пустые значения превращаем в «не задано».
 */
function formEntries(formData: FormData): Record<string, FormDataEntryValue | undefined> {
  const out: Record<string, FormDataEntryValue | undefined> = {}
  for (const [k, v] of formData.entries()) {
    out[k] = typeof v === 'string' && v.trim() === '' ? undefined : v
  }
  return out
}

/** Число из поля ввода: пустое — null, «12 000» и «12000» — 12000. */
function num(v: string | undefined): number | null {
  if (!v) return null
  const cleaned = v.replace(/[\s  ]/g, '').replace(',', '.')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n) : null
}

async function currentUserId(): Promise<number | null> {
  const jar = await cookies()
  const raw = jar.get('userId')?.value
  const n = raw ? Number(raw) : NaN
  if (Number.isInteger(n) && n > 0) return n

  // Пользователь не выбран — пишем на первого активного, чтобы касание
  // не осталось без автора. Выбор пользователя появится вместе с ролями.
  const db = await getDb()
  const [first] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.id))
    .limit(1)
  return first?.id ?? null
}

export type TouchState = { ok: boolean; error?: string; savedAt?: number } | null

export async function saveTouch(_prev: TouchState, formData: FormData): Promise<TouchState> {
  const parsed = TouchSchema.safeParse(formEntries(formData))
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => `${i.path.join('.') || '?'}: ${i.message}`)
      .join('; ')
    console.error('saveTouch: данные не прошли проверку —', where)
    return { ok: false, error: where || 'Некорректные данные' }
  }
  const d = parsed.data

  await recordTouch({
    clientId: d.clientId,
    campaignId: d.campaignId ?? null,
    linkId: d.linkId ?? null,
    userId: await currentUserId(),
    outcome: d.outcome,
    note: d.note,
    gotQuoteRequest: Boolean(d.gotQuoteRequest),
    contactPosition: d.contactPosition,
    peopleServed: num(d.peopleServed),
    monthlyBudget: num(d.monthlyBudget),
    otherSuppliers: d.otherSuppliers,
    clientType: d.clientType,
    isQualified: d.isQualified ?? null,
    rejectReason: d.rejectReason,
    nextStepDate: d.nextStepDate,
    nextStepTitle: d.nextStepTitle,
    currentStage: d.currentStage,
    stageTouched: Boolean(d.stageTouched),
    stage: d.stage,
  })

  return { ok: true, savedAt: Date.now() }
}

export interface ContactsState {
  ok: boolean
  message: string
}

/**
 * Контакты клиента руками.
 *
 * Телефонов в выгрузках 1С нет вовсе, а находят их по ходу дела — в 2ГИС,
 * СБИС, на сайте компании. Записать их было некуда, и найденный номер жил
 * в блокноте менеджера до первой уборки стола.
 */
export async function saveClientContacts(
  _prev: ContactsState | null,
  formData: FormData,
): Promise<ContactsState> {
  const schema = z.object({
    clientId: z.coerce.number().int().positive(),
    phone: z.string().trim().max(64).optional(),
    contactPerson: z.string().trim().max(200).optional(),
    email: z.string().trim().max(200).optional(),
  })
  const parsed = schema.safeParse(formEntries(formData))
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Некорректные данные' }
  }
  const d = parsed.data

  const db = await getDb()
  await db
    .update(clients)
    .set({
      phone: d.phone ?? null,
      contactPerson: d.contactPerson ?? null,
      email: d.email ?? null,
    })
    .where(eq(clients.id, d.clientId))

  /*
   * Если по клиенту уже висит заявка на звонок, номер в ней тоже поправляем.
   * Номер фиксируется в момент заявки — иначе робот наберёт тот, что был,
   * а человек будет смотреть на исправленный и не понимать, куда звонили.
   */
  if (d.phone) {
    await db
      .update(callRequests)
      .set({ phone: d.phone })
      .where(
        and(
          eq(callRequests.clientId, d.clientId),
          sql`${callRequests.state} in ('waiting', 'calling')`,
        ),
      )
  }

  revalidatePath('/clients', 'layout')
  return { ok: true, message: d.phone ? 'Сохранено' : 'Сохранено, телефон пуст' }
}

export interface CallRequestState {
  ok: boolean
  message: string
}

/**
 * Заявка роботу: позвонить этому клиенту.
 *
 * Прямо отсюда набрать номер нельзя. Система стоит на сервере, а звонит
 * робот на машине, до которой снаружи не достучаться — ему нужны SIP через
 * VPN и доступ к OpenAI, чего с российского сервера нет. Поэтому кнопка
 * оставляет заявку, а робот забирает её сам: при запущенном ожидании
 * это пара секунд.
 */
export async function requestBotCall(
  _prev: CallRequestState | null,
  formData: FormData,
): Promise<CallRequestState> {
  const schema = z.object({ clientId: z.coerce.number().int().positive() })
  const parsed = schema.safeParse(formEntries(formData))
  if (!parsed.success) return { ok: false, message: 'Клиент не найден' }

  const db = await getDb()
  const [client] = await db
    .select({ id: clients.id, phone: clients.phone, name: clients.name })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1)

  if (!client) return { ok: false, message: 'Клиент не найден' }
  if (!client.phone) return { ok: false, message: 'Сначала впишите телефон' }

  // Две заявки на одного клиента — два звонка подряд. Так делать не надо.
  const [pending] = await db
    .select({ id: callRequests.id })
    .from(callRequests)
    .where(
      and(
        eq(callRequests.clientId, client.id),
        sql`${callRequests.state} in ('waiting', 'calling')`,
      ),
    )
    .limit(1)
  if (pending) return { ok: true, message: 'Заявка уже в очереди у робота' }

  const link = await getClientCampaignLink(client.id)
  await db.insert(callRequests).values({
    clientId: client.id,
    campaignId: link?.campaignId ?? null,
    campaignClientId: link?.linkId ?? null,
    requestedBy: await currentUserId(),
    phone: client.phone,
  })

  revalidatePath('/clients', 'layout')
  return { ok: true, message: 'Робот позвонит — заявка в очереди' }
}

/**
 * Отменить заказанный звонок.
 *
 * Нажали не на том клиенте — и до появления этой кнопки исправить было
 * нечем: заявка висела, пока робот по ней не отзвонится.
 */
export async function cancelBotCall(
  _prev: CallRequestState | null,
  formData: FormData,
): Promise<CallRequestState> {
  const schema = z.object({ clientId: z.coerce.number().int().positive() })
  const parsed = schema.safeParse(formEntries(formData))
  if (!parsed.success) return { ok: false, message: 'Клиент не найден' }

  const db = await getDb()
  await db
    .update(callRequests)
    .set({ state: 'cancelled', finishedAt: new Date() })
    .where(
      and(
        eq(callRequests.clientId, parsed.data.clientId),
        sql`${callRequests.state} in ('waiting', 'calling')`,
      ),
    )

  revalidatePath('/clients', 'layout')
  return { ok: true, message: 'Звонок отменён' }
}

export interface CampaignPreviewRow {
  clientId: number
  key: string
  name: string
  totalSum: number
  lastOrderDate: string | null
  manager1c: string | null
  state: string
  touchCount: number
}

/**
 * Начало очереди кампании — для раскрывающегося списка на главной.
 *
 * Грузим по требованию и небольшими порциями: держать на странице все пять
 * очередей целиком — это пять тысяч строк, которые почти всегда не нужны.
 */
export async function previewCampaignClients(
  campaignId: number,
  limit = 25,
): Promise<CampaignPreviewRow[]> {
  const rows = await listCampaignClients(campaignId, Math.min(Math.max(limit, 1), 200))
  return rows.map((r) => ({
    clientId: r.clientId,
    key: r.key,
    name: r.name,
    totalSum: Number(r.totalSum),
    lastOrderDate: r.lastOrderDate ? String(r.lastOrderDate) : null,
    manager1c: r.manager1c,
    state: r.state,
    touchCount: Number(r.touchCount),
  }))
}

/**
 * Перевести на другую стадию вне звонка — например, отметить отправку КП
 * или начало работы. Возвращает ошибку текстом, чтобы форма её показала.
 */
export interface MoveResult {
  ok: boolean
  error?: string
}

export async function moveStage(input: unknown): Promise<MoveResult> {
  const schema = z.object({
    linkId: z.coerce.number().int().positive(),
    campaignId: z.coerce.number().int().positive(),
    stage: z.enum(['lead', 'contacted', 'audit', 'quote', 'decision', 'won', 'lost']),
    comment: z.string().trim().max(2000).optional(),
  })
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }
  }

  const { linkId, campaignId, stage, comment } = parsed.data
  const db = await getDb()
  const userId = await currentUserId()

  const [current] = await db
    .select({ stage: campaignClients.stage })
    .from(campaignClients)
    .where(eq(campaignClients.id, linkId))
    .limit(1)

  if (!current) return { ok: false, error: 'Карточка не найдена' }
  if (current.stage === stage) return { ok: true }

  await db
    .update(campaignClients)
    .set({
      stage,
      stageChangedAt: new Date(),
      lostReason: stage === 'lost' ? comment || null : null,
      // Дошедшие до конца воронки убираем из очереди обзвона
      state: stage === 'won' || stage === 'lost' ? 'done' : undefined,
    })
    .where(eq(campaignClients.id, linkId))

  await db.insert(stageChanges).values({
    campaignClientId: linkId,
    fromStage: current.stage,
    toStage: stage,
    userId,
    comment: comment || null,
  })

  revalidatePath(`/call/${campaignId}`)
  revalidatePath(`/call/${campaignId}/list`)
  revalidatePath(`/funnel/${campaignId}`)
  revalidatePath('/clients', 'layout')
  revalidatePath('/')
  return { ok: true }
}

export async function skipClient(campaignId: number, linkId: number) {
  const db = await getDb()
  await db
    .update(campaignClients)
    .set({
      position: sql`(select coalesce(max(${campaignClients.position}), 0) + 1
                     from ${campaignClients}
                     where ${campaignClients.campaignId} = ${campaignId})`,
    })
    .where(eq(campaignClients.id, linkId))
  revalidatePath(`/call/${campaignId}`)
}

export async function completeTask(taskId: number) {
  const db = await getDb()
  await db
    .update(tasks)
    .set({ status: 'done', completedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'open')))
  revalidatePath('/tasks')
}

export async function logout() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  jar.delete('userId')
  redirect('/login')
}
