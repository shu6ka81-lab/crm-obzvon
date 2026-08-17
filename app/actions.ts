'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db'
import { campaignClients, qualifications, tasks, touches, users } from '@/lib/db/schema'

const TouchSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
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
})

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
  const parsed = TouchSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }
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

  revalidatePath(`/call/${d.campaignId}`)
  revalidatePath('/')
  revalidatePath('/tasks')
  return { ok: true, savedAt: Date.now() }
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
