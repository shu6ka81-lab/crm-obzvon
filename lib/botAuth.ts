import { timingSafeEqual } from 'node:crypto'

/**
 * Ключ для голосового робота. Он ходит не браузером, сессии у него нет,
 * поэтому вход — по общему ключу из BOT_TOKEN.
 *
 * Пока ключ не задан, вход закрыт наглухо: незаданная переменная не должна
 * означать «пускать всех». Ошибиться тут — значит открыть телефоны клиентов
 * и записи разговоров любому, кто угадает адрес.
 */
export function checkBotToken(header: string | null): { ok: boolean; error?: string } {
  const expected = process.env.BOT_TOKEN
  if (!expected) {
    return { ok: false, error: 'Ключ робота не настроен на сервере (BOT_TOKEN)' }
  }

  const got = (header ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!got) return { ok: false, error: 'Нужен ключ: заголовок Authorization' }

  // Сравнение постоянного времени: обычное сравнение строк выдаёт длину
  // совпавшего начала задержкой, и ключ подбирается посимвольно.
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'Ключ не подошёл' }
  }
  return { ok: true }
}
