import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { liveCalls } from '@/lib/db/schema'
import { checkBotToken } from '@/lib/botAuth'

export const dynamic = 'force-dynamic'

/**
 * Разговор, который идёт прямо сейчас.
 *
 * Робот присылает реплики по мере распознавания, а карточка их показывает —
 * видно, как идёт звонок, не дожидаясь его конца. Это не украшение: слышно,
 * что робот несёт не то, и можно вмешаться до того, как разговор закончится.
 *
 * Хранится одна текущая запись на клиента и переписывается целиком: разговор
 * короткий, а склеивать куски на сервере — лишний повод их перепутать.
 */
const Body = z.object({
  clientId: z.coerce.number().int().positive(),
  transcript: z.string().max(200_000).optional(),
  status: z.string().trim().max(32).optional(),
  finished: z.coerce.boolean().optional(),
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  }
  const d = parsed.data

  const db = await getDb()
  const now = new Date()

  await db
    .insert(liveCalls)
    .values({
      clientId: d.clientId,
      transcript: d.transcript ?? '',
      status: d.status ?? 'звоним',
      startedAt: now,
      updatedAt: now,
      finishedAt: d.finished ? now : null,
    })
    .onConflictDoUpdate({
      target: liveCalls.clientId,
      set: {
        transcript: d.transcript ?? '',
        status: d.status ?? 'звоним',
        updatedAt: now,
        finishedAt: d.finished ? now : null,
      },
    })

  return NextResponse.json({ ok: true })
}

/** Карточка спрашивает раз в пару секунд: что там сейчас. */
export async function GET(req: NextRequest) {
  const auth = checkBotToken(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const clientId = Number(new URL(req.url).searchParams.get('client'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'Нужен клиент' }, { status: 400 })
  }

  const db = await getDb()
  const [row] = await db.select().from(liveCalls).where(eq(liveCalls.clientId, clientId)).limit(1)
  return NextResponse.json({ live: row ?? null })
}
