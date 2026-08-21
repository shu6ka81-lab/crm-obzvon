import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { callRequests, campaignClients } from '@/lib/db/schema'
import { checkBotToken } from '@/lib/botAuth'
import { recordTouch } from '@/lib/touch'
import { buildQuoteFromCall } from '@/lib/quoteFromCall'
import type { Stage } from '@/lib/funnel'

export const dynamic = 'force-dynamic'

/**
 * Категории робота → итог звонка в наших терминах.
 *
 * Робот думает про свой разговор, система — про очередь и воронку. Перевод
 * держим здесь, в одном месте: иначе он расползётся по коду двумя разными
 * версиями и однажды разойдётся.
 */
const CATEGORY_TO_OUTCOME: Record<string, TouchOutcome> = {
  hot: 'reached',
  warm: 'reached',
  not_dm: 'reached',
  not_target: 'refused',
  refused: 'refused',
  callback: 'callback',
  no_answer: 'no_answer',
  busy: 'busy',
  invalid: 'wrong_number',
}

type TouchOutcome = 'reached' | 'no_answer' | 'busy' | 'wrong_number' | 'callback' | 'refused'

const Body = z.object({
  clientId: z.coerce.number().int().positive(),
  /** Заявка, по которой звонили, — её надо закрыть, иначе повиснет в «звоним». */
  requestId: z.coerce.number().int().positive().optional(),
  campaignId: z.coerce.number().int().positive().optional(),
  linkId: z.coerce.number().int().positive().optional(),

  /** Категория робота — по ней и определяется итог, если он не задан явно. */
  category: z.string().trim().max(32).optional(),
  outcome: z
    .enum(['reached', 'no_answer', 'busy', 'wrong_number', 'callback', 'refused'])
    .optional(),

  summary: z.string().trim().max(4000).optional(),
  transcript: z.string().max(200_000).optional(),
  recording: z.string().trim().max(500).optional(),
  durationSec: z.coerce.number().int().min(0).max(36_000).optional(),
  costRub: z.coerce.number().min(0).max(100_000).optional(),

  gotQuoteRequest: z.coerce.boolean().optional(),
  contactPosition: z.string().trim().max(200).optional(),
  peopleServed: z.coerce.number().int().min(0).max(1_000_000).optional(),
  monthlyBudget: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  otherSuppliers: z.string().trim().max(500).optional(),
  isQualified: z.enum(['yes', 'no', 'thinking']).optional(),
  rejectReason: z.string().trim().max(500).optional(),

  nextStepDate: z.string().trim().max(32).optional(),
  nextStepTitle: z.string().trim().max(300).optional(),

  /**
   * Что клиент попросил посчитать — построчно, как он это назвал.
   * Если робот не выделил список, попробуем достать его из расшифровки.
   */
  items: z.array(z.string().trim().max(300)).max(200).optional(),
})

export async function POST(req: NextRequest) {
  const auth = checkBotToken(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Тело запроса не разобралось как JSON' }, { status: 400 })
  }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.join('.') || '?'}: ${i.message}`)
    return NextResponse.json({ error: where.join('; ') }, { status: 400 })
  }
  const d = parsed.data

  const outcome = d.outcome ?? (d.category ? CATEGORY_TO_OUTCOME[d.category] : undefined)
  if (!outcome) {
    return NextResponse.json(
      { error: `Не понял итог звонка: категория «${d.category ?? '—'}» неизвестна` },
      { status: 400 },
    )
  }

  // Текущую стадию берём из базы, а не из тела запроса: робот работает
  // асинхронно, и его представление о клиенте может отстать на несколько
  // минут — за это время менеджер мог руками сдвинуть карточку.
  const db = await getDb()
  let currentStage: Stage = 'lead'
  let linkId = d.linkId ?? null
  if (linkId) {
    const [link] = await db
      .select({ stage: campaignClients.stage })
      .from(campaignClients)
      .where(eq(campaignClients.id, linkId))
      .limit(1)
    if (!link) linkId = null
    else currentStage = link.stage as Stage
  }

  const res = await recordTouch({
    clientId: d.clientId,
    campaignId: d.campaignId ?? null,
    linkId,
    userId: null,
    channel: 'bot',
    outcome,
    note: d.summary,
    transcript: d.transcript,
    recording: d.recording,
    botCategory: d.category,
    costRub: d.costRub ?? null,
    durationSec: d.durationSec ?? null,
    gotQuoteRequest: Boolean(d.gotQuoteRequest),
    contactPosition: d.contactPosition,
    peopleServed: d.peopleServed ?? null,
    monthlyBudget: d.monthlyBudget ?? null,
    otherSuppliers: d.otherSuppliers,
    isQualified: d.isQualified ?? null,
    rejectReason: d.rejectReason,
    nextStepDate: d.nextStepDate,
    nextStepTitle: d.nextStepTitle,
    currentStage,
  })

  /*
   * Клиент по телефону назвал, что ему нужно, — собираем черновик КП сразу.
   * Раньше между «положил трубку» и «отправил предложение» лежал час ручной
   * работы, и часть заявок этот час не переживала.
   */
  let quote: Awaited<ReturnType<typeof buildQuoteFromCall>> = null
  /*
   * Пробуем на любом состоявшемся разговоре, а не только там, где робот
   * отметил «договорились о просчёте». Человек называет, что ему нужно,
   * посреди обычной беседы и отдельной галочки при этом не ставит.
   * Если в разговоре ничего похожего на заказ нет — просто ничего не выйдет.
   */
  if (d.items?.length || (outcome === 'reached' && d.transcript)) {
    try {
      quote = await buildQuoteFromCall({
        clientId: d.clientId,
        campaignClientId: linkId,
        items: d.items,
        transcript: d.transcript ?? null,
        note: d.summary ?? null,
      })
    } catch (e) {
      // Не сложилось — звонок всё равно записан. Терять разговор из-за
      // неудачной сборки предложения нельзя.
      console.error('КП из разговора не собралось:', e)
    }
  }

  if (d.requestId) {
    await db
      .update(callRequests)
      .set({ state: 'done', finishedAt: new Date() })
      .where(eq(callRequests.id, d.requestId))
  }

  return NextResponse.json({
    ok: true,
    touchId: res.touchId,
    stage: { from: res.stageFrom, to: res.stageTo },
    quote,
  })
}
