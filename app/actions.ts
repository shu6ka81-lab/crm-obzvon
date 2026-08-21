'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { suggestStage } from '@/lib/funnel'
import { listCampaignClients } from '@/lib/queries'
import {
  campaignClients,
  qualifications,
  stageChanges,
  tasks,
  touches,
  users,
} from '@/lib/db/schema'

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
  const db = await getDb()
  const userId = await currentUserId()

  const [touch] = await db
    .insert(touches)
    .values({
      clientId: d.clientId,
      campaignId: d.campaignId,
      userId,
      channel: 'call',
      outcome: d.outcome,
      gotQuoteRequest: Boolean(d.gotQuoteRequest),
      note: d.note || null,
    })
    .returning({ id: touches.id })

  // Квалификацию пишем, только если хоть что-то заполнено — иначе плодим пустые записи.
  const hasQual =
    d.contactPosition ||
    d.peopleServed ||
    d.monthlyBudget ||
    d.otherSuppliers ||
    d.isQualified ||
    (d.clientType && d.clientType !== 'unknown')

  if (hasQual) {
    await db.insert(qualifications).values({
      clientId: d.clientId,
      contactPosition: d.contactPosition || null,
      peopleServed: num(d.peopleServed),
      monthlyBudget: num(d.monthlyBudget),
      otherSuppliers: d.otherSuppliers || null,
      clientType: d.clientType ?? 'unknown',
      isQualified: d.isQualified ?? null,
      rejectReason: d.rejectReason || null,
      filledBy: userId,
    })
  }

  if (d.nextStepDate) {
    await db.insert(tasks).values({
      clientId: d.clientId,
      assignedTo: userId,
      dueDate: d.nextStepDate,
      title: d.nextStepTitle || 'Перезвонить',
      createdFromTouchId: touch.id,
    })
  }

  // Стадия воронки. Если её не выбирали руками — определяем по итогу звонка.
  const current = d.currentStage ?? 'lead'
  const nextStage =
    d.stageTouched && d.stage
      ? d.stage
      : suggestStage(current, d.outcome, Boolean(d.gotQuoteRequest))

  // Пишем только настоящий переход, иначе история забьётся пустыми записями.
  if (d.linkId && nextStage !== current) {
    await db
      .update(campaignClients)
      .set({
        stage: nextStage,
        stageChangedAt: new Date(),
        lostReason: nextStage === 'lost' ? d.rejectReason || d.note || null : null,
      })
      .where(eq(campaignClients.id, d.linkId))

    await db.insert(stageChanges).values({
      campaignClientId: d.linkId,
      fromStage: current,
      toStage: nextStage,
      userId,
      comment: d.note || null,
    })
  }

  // Куда двигаем клиента в очереди
  if (d.linkId) {
    if (d.outcome === 'reached' || d.outcome === 'refused' || d.outcome === 'wrong_number') {
      await db
        .update(campaignClients)
        .set({ state: 'done' })
        .where(eq(campaignClients.id, d.linkId))
    } else if (d.outcome === 'callback') {
      await db
        .update(campaignClients)
        .set({ state: 'postponed' })
        .where(eq(campaignClients.id, d.linkId))
    } else {
      // Не взяли или занято — в конец очереди, попробуем позже
      await db
        .update(campaignClients)
        .set({
          position: sql`(select coalesce(max(${campaignClients.position}), 0) + 1
                         from ${campaignClients}
                         where ${campaignClients.campaignId} = ${d.campaignId})`,
        })
        .where(eq(campaignClients.id, d.linkId))
    }
  }

  if (d.campaignId) {
    revalidatePath(`/call/${d.campaignId}/list`)
    revalidatePath(`/funnel/${d.campaignId}`)
    revalidatePath(`/call/${d.campaignId}`)
  }
  revalidatePath('/clients', 'layout')
  revalidatePath('/')
  revalidatePath('/tasks')
  return { ok: true, savedAt: Date.now() }
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
