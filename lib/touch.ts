import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from './db'
import { campaignClients, qualifications, stageChanges, tasks, touches } from './db/schema'
import { suggestStage, type Stage } from './funnel'

/**
 * Запись разговора: касание, квалификация, задача, движение по воронке
 * и по очереди обзвона.
 *
 * Живёт отдельно от формы, потому что разговоров теперь два вида — с человеком
 * и с роботом, — а последствия у них одни и те же. Пока это лежало внутри
 * обработчика формы, второй вход неизбежно завёл бы вторую копию правил,
 * и они разъехались бы на первой же правке.
 */
export interface TouchInput {
  clientId: number
  campaignId?: number | null
  linkId?: number | null
  userId?: number | null

  outcome: 'reached' | 'no_answer' | 'busy' | 'wrong_number' | 'callback' | 'refused'
  note?: string | null
  gotQuoteRequest?: boolean

  /** Голосовой робот. Пишется в тот же журнал, но видно, что звонил не человек. */
  channel?: 'call' | 'bot'
  transcript?: string | null
  recording?: string | null
  botCategory?: string | null
  costRub?: number | null
  durationSec?: number | null

  contactPosition?: string | null
  peopleServed?: number | null
  monthlyBudget?: number | null
  otherSuppliers?: string | null
  clientType?: 'legal' | 'individual' | 'intercity' | 'unknown'
  isQualified?: 'yes' | 'no' | 'thinking' | null
  rejectReason?: string | null

  nextStepDate?: string | null
  nextStepTitle?: string | null

  currentStage?: Stage
  /** Стадию выбрали руками — тогда не подсказываем свою. */
  stageTouched?: boolean
  stage?: Stage
}

export interface TouchResult {
  touchId: number
  stageFrom: Stage
  stageTo: Stage
}

export async function recordTouch(d: TouchInput): Promise<TouchResult> {
  const db = await getDb()
  const userId = d.userId ?? null

  const [touch] = await db
    .insert(touches)
    .values({
      clientId: d.clientId,
      campaignId: d.campaignId ?? null,
      userId,
      channel: d.channel ?? 'call',
      outcome: d.outcome,
      gotQuoteRequest: Boolean(d.gotQuoteRequest),
      note: d.note || null,
      transcript: d.transcript || null,
      recording: d.recording || null,
      botCategory: d.botCategory || null,
      costRub: d.costRub ?? null,
      durationSec: d.durationSec ?? null,
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
      peopleServed: d.peopleServed ?? null,
      monthlyBudget: d.monthlyBudget ?? null,
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
  const current: Stage = d.currentStage ?? 'lead'
  const nextStage: Stage =
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

  return { touchId: touch.id, stageFrom: current, stageTo: nextStage }
}
