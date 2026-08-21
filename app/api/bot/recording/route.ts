import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { touches } from '@/lib/db/schema'
import { checkBotToken } from '@/lib/botAuth'
import { saveRecording } from '@/lib/recordings'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

/** Больше этого разговоров не бывает: минута — около мегабайта. */
const MAX_BYTES = 60 * 1024 * 1024

/**
 * Запись разговора от робота.
 *
 * Файл живёт там, где звонили, — на машине с телефонией. Пока он лежит только
 * там, послушать разговор из системы нельзя: в карточке было имя файла,
 * которого ни у кого, кроме звонившего, нет.
 *
 * Тело запроса — сам файл, без обёрток: так проще и на той стороне, и здесь.
 */
export async function POST(req: NextRequest) {
  const auth = checkBotToken(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const url = new URL(req.url)
  const touchId = Number(url.searchParams.get('touch'))
  const name = url.searchParams.get('name') ?? 'запись.wav'

  const body = await req.arrayBuffer()
  if (body.byteLength === 0) {
    return NextResponse.json({ error: 'Пустой файл' }, { status: 400 })
  }
  if (body.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: `Файл больше ${Math.round(MAX_BYTES / 1024 / 1024)} МБ` },
      { status: 413 },
    )
  }

  const saved = await saveRecording(name, Buffer.from(body), touchId)

  // Привязываем к разговору, если сказали к какому: иначе файл сохранится,
  // но найти его из карточки будет нечем.
  if (Number.isInteger(touchId) && touchId > 0) {
    const db = await getDb()
    await db.update(touches).set({ recording: saved }).where(eq(touches.id, touchId))
    revalidatePath('/clients', 'layout')
  }

  return NextResponse.json({ ok: true, file: saved, bytes: body.byteLength })
}
