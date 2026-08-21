import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { readRecording, safeName } from '@/lib/recordings'

export const dynamic = 'force-dynamic'

/**
 * Отдаёт запись разговора для прослушивания в карточке.
 *
 * Закрыто сессией, а не ключом робота: слушают люди. Запись — это голос
 * клиента и разговор о его закупках, отдавать такое по прямой ссылке нельзя.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const jar = await cookies()
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'Нужен вход' }, { status: 401 })

  const { name } = await params
  const file = safeName(decodeURIComponent(name))
  const data = await readRecording(file)
  if (!data) return NextResponse.json({ error: 'Записи нет' }, { status: 404 })

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
      'Content-Length': String(data.length),
      // Записи не меняются, но и в общий кэш их класть нельзя
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
