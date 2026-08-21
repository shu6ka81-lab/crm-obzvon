import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from './db'
import { callRequests, settings } from './db/schema'

/** Когда робот последний раз спрашивал очередь. */
export const BOT_SEEN_KEY = 'bot.lastSeen'

/**
 * На связи ли робот и что с заявкой на звонок.
 *
 * Без этого система молчит: человек нажимает «Позвонить», ничего не
 * происходит, и понять почему нельзя — робот не запущен, занят другим
 * разговором или уже звонит этому клиенту. Молчание в ответ на нажатие —
 * худшее, что интерфейс может сделать.
 */
export interface BotStatus {
  online: boolean
  lastSeen: Date | null
  /** Сколько секунд назад робот выходил на связь. */
  secondsAgo: number | null
  request: {
    state: string
    createdAt: Date
  } | null
}

/** Дольше этого без запроса — считаем, что робот не работает. */
const ONLINE_WITHIN_SEC = 30

export async function getBotStatus(clientId?: number): Promise<BotStatus> {
  const db = await getDb()

  const [seen] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, BOT_SEEN_KEY))
    .limit(1)

  const lastSeen = seen?.value ? new Date(seen.value) : null
  const secondsAgo = lastSeen ? Math.round((Date.now() - lastSeen.getTime()) / 1000) : null

  let request: BotStatus['request'] = null
  if (clientId) {
    const [row] = await db
      .select({ state: callRequests.state, createdAt: callRequests.createdAt })
      .from(callRequests)
      .where(
        and(
          eq(callRequests.clientId, clientId),
          sql`${callRequests.state} in ('waiting', 'calling')`,
        ),
      )
      .orderBy(desc(callRequests.createdAt))
      .limit(1)
    if (row) request = { state: row.state, createdAt: row.createdAt }
  }

  return {
    online: secondsAgo != null && secondsAgo <= ONLINE_WITHIN_SEC,
    lastSeen,
    secondsAgo,
    request,
  }
}
